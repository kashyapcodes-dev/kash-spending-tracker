# M3: Migration and cutover

- **Status:** Not started
- **Depends on:** M1, M2
- **ADRs:** [0001](../../adr/0001-foundational-decisions.md), [0002](../../adr/0002-transactions-table.md)

## Goal

Move the owner's real data from the original Supabase-hosted app into a self-hosted Kash instance, prove nothing was lost or changed, and retire the old deployment. The tool is one-time in purpose but is written and tested like product code, because a wrong total here destroys trust in everything after it.

## Scope

1. **A CLI, `tools/migrate-supabase`**, a workspace package run as `pnpm migrate:supabase <command>`.
2. **Source access.** A read-only Postgres connection string to the Supabase database (`SOURCE_DATABASE_URL`), or a restored `pg_dump` of it. The tool only ever runs `SELECT` on the source, inside a read-only transaction.
3. **Commands.**
   - `inspect`: connects to the source, checks the expected tables and columns exist, prints row counts and anything unexpected. Writes nothing.
   - `run --dry-run`: performs the whole transformation inside a target transaction and rolls it back, then prints the verification report.
   - `run`: the same, committed. Refuses to run if the target has any user or budget unless `--allow-non-empty` is given.
   - `verify`: re-computes the verification report from source and target at any later time.
4. **Schema mapping** (below), including money and date conversion.
5. **Auth import** with password hashes where possible (below).
6. **Verification report** as JSON and Markdown.
7. **Cutover runbook**, `docs/migration-from-supabase.md`.

## Non-scope

- Continuous or two-way sync between the old and new systems.
- Migrating from any source other than the original app's schema.
- Importing Supabase row-level-security policies. They are replaced by the service layer.
- Supabase storage, edge functions or realtime (the original uses none).

## Data model changes

None to the application schema. The tool creates one table in the target for traceability, which may be dropped after cutover:

```
migration_id_map
  entity     text not null      -- 'user' | 'budget' | 'category' | 'transaction'
  source_id  text not null      -- original id (integer or uuid as text); for transactions prefixed 'expense:' or 'income:'
  target_id  text not null
  primary key (entity, source_id)
```

### Source schema (inferred from the original code; `inspect` confirms it)

`budgets(id, name)`, `budget_users(user_id, budget_id)`, `categories(id, budget_id, name, is_active)`, `expenses(id, budget_id, category_id, name, amount, date)`, `incomes(id, budget_id, name, amount, date)`, and Supabase's `auth.users(id, email, encrypted_password, email_confirmed_at, created_at)`.

### Mapping

| Source | Target | Rule |
|---|---|---|
| `auth.users` | `user` and `account` (Better Auth) | Email lower-cased. `emailVerified` from `email_confirmed_at`. Password per [Auth import](#auth-import). Users with no `budget_users` row are still migrated and get an empty "My Budget". |
| `budgets` | `budgets` | New UUID. `currency` = `USD`. `created_by` = the budget's owner. |
| `budget_users` | `budget_members` | The source has no roles. For each budget, the member whose user was created earliest becomes `owner`; other members become `editor`. A `--owner-email` option overrides the choice for all budgets that user belongs to. Budgets with no members are reported and skipped. |
| `categories` | `categories` | `is_active` null → `true`. Names trimmed. Names that collide case-insensitively within a budget get a numeric suffix (`Food`, `Food (2)`), and each rename is listed in the report. |
| `expenses` | `transactions` with `type = 'expense'` | `amount_cents` = amount × 100 computed with exact decimal arithmetic on the text value, never floats. A `category_id` that does not exist or belongs to another budget becomes null and is reported. |
| `incomes` | `transactions` with `type = 'income'` | Empty name → `"Income"`. `category_id` null. |
| dates | `date` | Read as text (`::date::text`) and written unchanged. Timestamps in the source, if any, are converted to a date in UTC and reported. |

Rows that cannot be migrated (amount zero or negative, more than two decimal places that would lose value, null date, missing budget) are **not** silently dropped or fixed: they are listed in the report with the reason, and `run` fails unless `--skip-invalid` is given.

### Auth import

Supabase stores bcrypt password hashes. Better Auth's default hash is different, but it allows custom hash and verify functions.

1. **Preferred:** import each hash into the Better Auth credential account as-is, and configure password verification to recognise a bcrypt hash, verify against it, and on the first successful sign-in re-hash with the default algorithm. Users keep their passwords and notice nothing.
2. **Fallback**, if the installed Better Auth version cannot do this cleanly: import users with no password and require a reset on first sign-in; the runbook then requires SMTP to be configured before cutover.

Check Better Auth's current documentation before implementing. Record which path was taken, and why, in an ADR. The bcrypt verification support stays in the app after cutover only if it costs nothing; otherwise it is behind a `LEGACY_BCRYPT_PASSWORDS` flag that the runbook turns off once every imported user has signed in or reset.

Password hashes are never written to the report, the log or the ID map.

## Verification report

Produced by `run` (both modes) and `verify`. The run fails (and, when not a dry run, rolls back) if any **must-match** check fails.

| Check | Must match |
|---|---|
| User count; set of emails | yes |
| Budget count (minus reported skips) | yes |
| Membership count; every budget has at least one owner | yes |
| Category count per budget | yes |
| Expense count and income count per budget (minus reported skips) | yes |
| Sum of expense amounts and of income amounts per budget, in cents | yes, to the cent |
| The same sums per budget per calendar month | yes |
| Sum of expenses per category per budget | yes |
| Earliest and latest transaction date per budget | yes |
| Count of uncategorised expenses per budget | yes, after reported orphan fixes |
| A random sample of 200 transactions compared field by field through the ID map | yes |

The report also lists: renamed categories, orphaned category references, skipped rows with reasons, the role assigned to each member, and the duration. The Markdown version is suitable for pasting into the devlog with emails redacted (`--redact`).

## API endpoints

None. The tool writes through `packages/db` directly, as a system-level operation outside any user session.

| Method | Path | Purpose | Authz |
|---|---|---|---|
| n/a | n/a | No HTTP surface is added in this milestone | The CLI requires direct database credentials for both systems; it is not reachable over the network and is not included in the production image. |

## UI

None. After cutover the owner uses the normal app.

## Cutover runbook (`docs/migration-from-supabase.md`)

1. Deploy Kash with M2's compose on the target hardware. Do not sign up.
2. Take a `pg_dump` of the Supabase database and keep it. This is the rollback copy.
3. `inspect`, then `run --dry-run`; read the report; resolve anything listed.
4. Put the old app in read-only mode or stop using it, so no data changes during the move.
5. `run`. Keep the report.
6. Sign in with the existing password. Check the dashboard for a known month against the old app.
7. Run both apps side by side for one week, entering data only in Kash.
8. `verify` once more against the frozen source, then take the old deployment down. Keep the dump for 90 days.
9. Rollback at any point before step 8: return to the old app, which was never modified.

## Acceptance tests

Tests run against two throwaway Postgres databases: a "source" loaded from a SQL fixture that reproduces the original schema (including an `auth.users` table), and an empty migrated target. The fixture is synthetic; no real data is committed.

Vitest (integration):

- `M3-I-1` Happy path: fixture with 2 users, 3 budgets (one shared), 12 categories, 500 expenses, 40 incomes → `run` succeeds and every must-match check passes.
- `M3-I-2` Dry run leaves the target with zero users, budgets and transactions, and still prints a full report.
- `M3-I-3` Running `run` twice → the second is refused because the target is not empty; nothing is duplicated.
- `M3-I-4` Money: amounts `0.01`, `0.10`, `19.99`, `1234.56`, `100` migrate to `1`, `10`, `1999`, `123456`, `10000`; a fixture total that floating-point summation gets wrong still matches to the cent.
- `M3-I-5` Invalid rows (amount `0`, `-5`, `1.999`, null date) fail the run by default and are listed; with `--skip-invalid` they are skipped, listed, and the counts reconcile.
- `M3-I-6` Dates: a transaction dated the 1st of a month stays on the 1st with the tool run under `TZ=Pacific/Kiritimati` and `TZ=Pacific/Pago_Pago`.
- `M3-I-7` Roles: the earliest-created member becomes owner, others editor; `--owner-email` overrides; a budget with no members is skipped and reported.
- `M3-I-8` Category collisions (`Food`, `food`) are renamed and reported; an expense pointing at a category in another budget becomes uncategorised and is reported.
- `M3-I-9` `is_active` null → true.
- `M3-I-10` The source connection is read-only: a test wraps the source in a role with no write privileges and the run still succeeds.
- `M3-I-11` Tampering test: after a run, change one target amount by one cent → `verify` fails and names the budget and month.
- `M3-I-12` The report and logs contain no password hash (search for the fixture's hash strings).

Auth (Vitest, against the app):

- `M3-A-1` (preferred path) A user imported with a bcrypt hash signs in with the original password; afterwards the stored hash is in the default format; signing in again still works.
- `M3-A-2` A wrong password for an imported user is rejected.
- `M3-A-3` (fallback path, if taken) An imported user cannot sign in until completing a reset, and can afterwards.

Playwright:

- `M3-E-1` After migrating the fixture into a running app, an imported user signs in and the dashboard for a fixture month shows the expected totals; the shared budget appears for both users with the right roles.

Manual (recorded in the devlog, not automated):

- `M3-M-1` The owner's real migration: dry-run report clean, real run report clean, three spot-checked months match the old app, old deployment retired.

## Demo end state

The owner signs in to a self-hosted Kash with their existing password and sees years of real data. The verification report shows every count and total matching to the cent. The Supabase project is paused.

## Devlog prompt

Film and write: the real cutover. Show the dry-run report on real data with amounts blurred, and whatever it found that nobody expected (orphaned categories, duplicate names, odd amounts). Explain why the tool refuses to "fix" data silently. Show the tampering test. Be honest about the moment of trusting an agent-written script with the only copy of real financial data, and what made that acceptable (read-only source, dry run, rollback copy).

## Locked decisions covered

Migration, Backend (leaving Supabase).
