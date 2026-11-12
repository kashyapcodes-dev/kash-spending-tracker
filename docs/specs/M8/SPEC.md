# M8: Hosted mode (before billing)

- **Status:** Not started. Complete, but the furthest out and the most likely to change.
- **Depends on:** M2, M4, M5, M7
- **ADRs:** [0001](../../adr/0001-foundational-decisions.md), [0004](../../adr/0004-background-jobs.md), [0005](../../adr/0005-encryption-at-rest.md)

## Goal

The same codebase can run as a multi-user service operated by the owner for people who do not want to self-host. Setting `HOSTED_MODE=true` turns on what a public service needs: verified email, limits per plan, operator-provided Plaid and AI keys with usage caps, account export and deletion, and the operations to keep it running. Nobody is charged yet: every hosted user is on a free plan, and the place where a billing provider will attach is defined and empty.

## Scope

1. `HOSTED_MODE` flag and the rule for how hosted-only behaviour is written.
2. Plans and entitlements: a seam in `packages/core` that every limited feature asks.
3. Usage metering for AI messages and bank connections.
4. Managed keys: the operator's Plaid and AI credentials, with per-plan caps.
5. Public-service requirements: email verification, rate limiting, abuse controls, terms and privacy pages, data export, account deletion.
6. A minimal operator view.
7. Operations: backups with restore tests, monitoring, error reporting, structured logs, a runbook.
8. The billing seam, unimplemented.

## Non-scope

- Choosing or integrating a billing provider, checkout, invoices, paid plans, trials, coupons.
- A marketing site.
- Organisation accounts, SSO, audit exports for businesses.
- Multi-region deployment and formal compliance certifications.
- Any feature that exists only in hosted mode and is useful to self-hosters. If self-hosters would want it, it ships for everyone.

## Design

### The hosted-mode rule

- `HOSTED_MODE` is read in one place (`core/config`) and exposed as `isHosted()`.
- Hosted-only behaviour is added as policy, not as forks in feature code: features ask `entitlements` and `usage`; in self-host those answer "unlimited" and "do nothing".
- There are no closed-source modules and no private build. Everything is in this repository under AGPL-3.0.
- CI runs the whole test suite twice, with `HOSTED_MODE` unset and set, so neither mode rots.
- With `HOSTED_MODE` unset, nothing in this milestone changes behaviour for self-hosters, except that data export and account deletion become available to them too.

### Plans and entitlements

Plans are data in code (`core/plans.ts`), not database rows, until billing exists:

```ts
type Entitlements = {
  maxBudgets: number | null;            // null = unlimited
  maxMembersPerBudget: number | null;
  maxBankConnections: number | null;
  bankSyncProviders: ('plaid' | 'simplefin')[];
  aiMessagesPerMonth: number | null;
  aiEnabled: boolean;
};
```

- `self_host`: everything unlimited. The only plan when `HOSTED_MODE` is off.
- `free`: the default for hosted users. Concrete numbers are set in `core/plans.ts` at implementation time; the tests use the constants, not literals.
- `internal`: unlimited, assignable by the operator (for the owner and testers).

`getEntitlements(userId)` is the single entry point. Limits on a budget (members, bank connections) follow the plan of the budget's owner; with several owners, the most generous. Services call `entitlements.require(actor, 'maxBudgets', currentCount)` and get a typed `limit_reached` error (HTTP `402`, with the limit and the current value) that the UI turns into a clear message. Reaching a limit never deletes or hides existing data; it only blocks adding more.

### Billing seam

```ts
interface BillingProvider {
  getPlanFor(userId): Promise<PlanId>;
  // later: createCheckout, handleWebhook, portalUrl
}
```

The only implementation in M8 is `StaticBillingProvider`, which reads `users.plan`. A future billing integration is a new implementation plus a webhook route; no feature code changes. This interface and that sentence are the whole of billing in this milestone.

### Usage metering

`usage_counters` holds monthly counts per user and metric. The M7 usage hook is implemented for hosted mode: check the counter against the entitlement before a model call, increment after, and record tokens. Bank connections are counted from their table, not a counter. Counters reset by calendar month in UTC.

### Managed keys

In hosted mode the operator's `PLAID_*` and AI provider keys serve all users, so:

- AI use is capped by `aiMessagesPerMonth`, plus an instance-wide daily spend guard (`AI_DAILY_TOKEN_BUDGET`) that disables AI for everyone, with a notice, when exceeded.
- Bank connections are capped by `maxBankConnections`. Plaid webhooks are enabled (the service is reachable), with signature verification as in M5.
- The provider and model are fixed by the operator; users cannot point the service at another endpoint.

### Public-service requirements

- **Email verification** is required before a hosted account can create data or accept an invite. SMTP is therefore mandatory in hosted mode; the app refuses to start hosted without it.
- **Rate limiting** on authentication, invites, token creation, imports, AI and widget queries, per user and per IP, backed by Postgres or memory with one interface. Self-host uses the same limiter with generous defaults.
- **Signup abuse:** disposable-domain blocking is optional by configuration; a simple proof-of-work or CAPTCHA hook exists and is off by default.
- **Legal pages:** `/terms` and `/privacy` rendered from Markdown files the operator supplies by path; the signup form requires acceptance and records the version accepted. Self-host hides these unless files are configured.
- **Data export:** a user can download everything they own or can access as a ZIP of JSON and CSV files (profile, budgets, categories, transactions, targets, dashboards, conversations, proposals). Built as a background job with a download link that expires.
- **Account deletion:** a user can delete their account after re-entering their password. Budgets they solely own are deleted with all their data and bank connections are disconnected at the provider; budgets with another owner are left and the user's membership removed; a solely owned budget that has other members blocks deletion until ownership is transferred or the user confirms deleting it for everyone. Deletion is a job that completes within minutes and is recorded (user ID hash and time only).
- **Security headers:** a strict Content-Security-Policy, HSTS, frame denial and referrer policy, on in both modes.

### Operator view

Pages under `/admin`, visible only to users with `users.is_operator = true` (set by a CLI command, never through the API): instance totals (users, budgets, active bank connections, AI messages this month, queue depth, failed jobs), a user list (email, plan, created, last active, counts; no budget contents), setting a user's plan to `free` or `internal`, and suspending or unsuspending a user. The operator view never shows transactions, and operator actions are logged. In self-host the first user is not automatically an operator; the CLI grants it.

### Operations

- **Backups:** scheduled encrypted dumps to object storage, retention policy, and a restore test that runs on a schedule against a scratch database and alerts on failure. `APP_ENCRYPTION_KEY` is stored separately from backups.
- **Monitoring:** a metrics endpoint in Prometheus format (request rates and latencies, job durations and failures, sync outcomes, AI usage), and alerts for health-check failures, failed-job spikes, sync error rates and backup failures.
- **Errors:** an error-reporting hook with a pluggable sink (off unless configured), scrubbing request bodies, emails and anything matching secret patterns.
- **Logs:** structured JSON with request IDs; no transaction names, amounts or secrets at `info` level.
- **Deployment:** separate web and worker processes (`WORKER_MODE=separate`), at least two web instances behind a proxy, migrations run as a release step rather than on boot (`AUTO_MIGRATE=false`).
- **`docs/operations.md`:** deploy, roll back, restore from backup, rotate keys, respond to a leaked credential, handle a deletion or export request by hand, suspend an abusive account.

## Data model changes

```
user (additions)
  plan           text not null default 'free'       -- 'free' | 'internal'; ignored when not hosted
  is_operator    boolean not null default false
  suspended_at   timestamptz null
  terms_version  text null
  terms_accepted_at timestamptz null

usage_counters
  user_id   text not null references user(id) on delete cascade
  metric    enum('ai_messages','ai_input_tokens','ai_output_tokens') not null
  period    date not null                           -- first day of the month, UTC
  value     bigint not null default 0
  primary key (user_id, metric, period)

data_exports
  id          uuid pk
  user_id     text not null references user(id) on delete cascade
  status      enum('pending','ready','failed','expired') not null
  file_path   text null
  expires_at  timestamptz null
  created_at  timestamptz

operator_audit_log
  id          uuid pk
  operator_id text not null
  action      text not null                         -- 'set_plan' | 'suspend' | 'unsuspend'
  target_user text not null
  detail      jsonb null
  created_at  timestamptz not null default now()

account_deletions
  user_hash   text not null                         -- SHA-256 of the user id, for de-duplication of requests
  deleted_at  timestamptz not null default now()
```

A suspended user's sessions and tokens are rejected with `403 account_suspended`; their data is untouched and other members of shared budgets are unaffected.

## API endpoints

| Method | Path | Purpose | Authz |
|---|---|---|---|
| GET | `/api/v1/config` | Adds `hosted`, `termsVersion` and whether AI and each bank provider are available on this instance | Public. No secrets, nothing user-specific. |
| GET | `/api/v1/me/entitlements` | The caller's plan, entitlements and current usage against each limit | Authenticated; own data only |
| POST | `/api/v1/me/export` | Request a data export | Authenticated, browser session only; rate limited to one per day |
| GET | `/api/v1/me/export/{exportId}` | Status, and a download when ready | Authenticated; the export must be the caller's (`404` otherwise) |
| DELETE | `/api/v1/me` | Delete the account `{ password, confirmDeleteSharedBudgetIds? }` | Authenticated, browser session only, password re-entered. Refused for personal access tokens. |
| POST | `/api/v1/me/accept-terms` | Record acceptance of the current terms version | Authenticated |
| GET | `/api/v1/admin/overview` | Instance totals | Operator. `404` for everyone else, so the admin surface is not discoverable. |
| GET | `/api/v1/admin/users` | User list with plan and counts; no budget contents | Operator |
| PATCH | `/api/v1/admin/users/{userId}` | Set plan, suspend or unsuspend; writes the operator audit log | Operator. An operator cannot change their own operator flag or suspend themselves. |
| GET | `/api/v1/metrics` | Prometheus metrics | Bearer token from `METRICS_TOKEN`; `404` when the variable is unset. Contains no user data. |

Existing endpoints gain entitlement checks (create budget, create invite, complete bank link, send AI message) that return `402 limit_reached`. Their authorization rules are unchanged; the entitlement check runs after the role check, so a non-member still gets `404`, never a limit message.

New configuration: `HOSTED_MODE`, `AI_DAILY_TOKEN_BUDGET`, `METRICS_TOKEN`, `TERMS_FILE`, `PRIVACY_FILE`, `ERROR_REPORTING_DSN`, `BACKUP_*`, `BLOCK_DISPOSABLE_EMAILS`.

## UI

- **Settings → Plan and usage:** the plan name, each limit with a usage bar, and a neutral note that paid plans do not exist yet.
- **Limit messages:** wherever a limit blocks an action, an inline explanation with the limit and current usage. No dead buttons.
- **Settings → Your data:** export (request, progress, download) and delete account (explains exactly what will be deleted, lists shared budgets needing a decision, asks for the password).
- **Signup (hosted):** terms and privacy acceptance, then a "verify your email" screen with resend.
- **`/admin`** for operators, as described above.
- **Footer:** terms, privacy and source code links. The source link is present in both modes.
- **Self-host:** none of the plan, limit or legal UI appears.

## Acceptance tests

CI runs the full existing suite in both modes. New tests:

### Authz

- `M8-AZ-1` Every `/api/v1/admin/*` endpoint returns `404` to a non-operator, including budget owners, and `401` with no session.
- `M8-AZ-2` No admin endpoint response contains a transaction, category name or budget name (assert against fixtures).
- `M8-AZ-3` The operator flag cannot be set through any API endpoint (attempt it on every `PATCH` that touches users).
- `M8-AZ-4` A user cannot fetch another user's export (`404`), and an export contains only budgets the requester belongs to; for a shared budget it contains no other member's email beyond their display name.
- `M8-AZ-5` Account deletion and export request are refused for personal access tokens.
- `M8-AZ-6` Entitlement errors never reveal a budget the caller cannot access: a non-member hitting a limited endpoint gets `404`, not `402`.
- `M8-AZ-7` A suspended user is rejected on every endpoint, including with a token; other members of their shared budgets keep access.
- `M8-AZ-8` The metrics endpoint returns `404` without the configured token and contains no emails or names.

### Unit and API (Vitest)

- `M8-U-1` With `HOSTED_MODE` off, `getEntitlements` returns unlimited for everything, and no entitlement or usage check ever blocks (property test over every limited action).
- `M8-U-2` With `HOSTED_MODE` on, each limit blocks at the limit and allows below it: budgets, members per budget, bank connections, AI messages per month. The error carries the limit and current value.
- `M8-U-3` Reaching a limit does not remove access to existing data (a user over the budget limit after a plan change can still read and edit all budgets and cannot create another).
- `M8-U-4` Budget-level limits follow the owner's plan; with two owners, the more generous plan applies.
- `M8-U-5` Usage counters: increments are atomic under concurrency (50 parallel messages count 50); a new month starts at zero; the instance-wide token budget disables AI when exceeded and re-enables the next day.
- `M8-U-6` `StaticBillingProvider` returns the stored plan; swapping in a fake provider changes entitlements with no other code change.
- `M8-U-7` Hosted start-up refuses to boot without SMTP or without `APP_ENCRYPTION_KEY`, and the error names what is missing.
- `M8-U-8` Email verification: an unverified hosted user cannot create a transaction or accept an invite; after verifying, they can. In self-host, verification is not required.
- `M8-U-9` Export: the archive contains every table's rows for the user's budgets, the totals in the CSV equal the API's totals, and it contains no password hash, token hash or bank secret. The link expires.
- `M8-U-10` Deletion: a sole-owner budget and all its rows are gone; bank connections were disconnected at the fake provider; a co-owned budget remains with the user removed; a solely owned budget with other members blocks deletion until confirmed; afterwards the email can sign up again as a new user.
- `M8-U-11` Rate limiter: limits apply per user and per IP, and reset after the window.
- `M8-U-12` Terms: signup without acceptance is refused in hosted mode; a new terms version prompts for acceptance again.
- `M8-U-13` Log scrubbing: a request that fails with a body containing a password, a bank token and an email produces log and error-report output containing none of them.
- `M8-U-14` Operator actions write the operator audit log.

### End to end (Playwright, hosted mode)

- `M8-E-1` Sign up → accept terms → verify email through the test mailer → land in the app.
- `M8-E-2` Create budgets up to the free limit → the next attempt shows the limit message with usage.
- `M8-E-3` Request an export → download it → the archive opens and holds the user's transactions.
- `M8-E-4` Delete the account → signed out → signing in fails → the co-owned budget is still there for the other owner.
- `M8-E-5` An operator sets a user's plan to `internal` → that user's limits disappear.
- `M8-E-6` Self-host mode: no plan page, no terms prompt, no verification gate, and `/admin` is not found for a normal user.

### Operations (scripted, run on a schedule rather than every pull request)

- `M8-O-1` Backup then restore into a scratch database → row counts and transaction totals match the source.
- `M8-O-2` Web and worker as separate processes: a sync enqueued by the web process is executed by the worker; with two web instances, a scheduled job runs once.
- `M8-O-3` Key rotation runbook: rotate `APP_ENCRYPTION_KEY` following `docs/operations.md` on a staging copy → bank connections still sync.
- `M8-O-4` Kill the database for one minute under light load → the service recovers without a restart and the alert fires.

## Demo end state

A public instance at the owner's domain: a stranger signs up, verifies their email, uses Kash within the free limits with the operator's AI and Plaid keys, exports their data and deletes their account, all without the owner doing anything. The owner's operator page shows the instance is healthy and how much AI it used today. The same commit, with one environment variable removed, is the self-hosted app from M2. Turning on payments later means writing one class.

## Devlog prompt

Film and write: what changes when strangers use the thing: the list of everything a hobby app never needed. Show both modes running from the same commit and the CI matrix that keeps them honest. Walk through account deletion and its edge cases with shared budgets. Talk about the cost side of managed AI and Plaid keys, with real numbers from the instance. Close the series arc: what the agents built, what the specs caught, what needed a human, and the honest answer to how far to trust them.

## Locked decisions covered

Billing (deferred; `HOSTED_MODE` flag and plan and entitlement seams only), Licence (single AGPL repository, hosted features by configuration), Bank sync and AI (managed keys in hosted mode, usage limits hook).
