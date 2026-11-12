# M5: Import and bank sync

- **Status:** Not started. Complete, but expect revision once earlier milestones have landed.
- **Depends on:** M1, M2 (M4 for role behaviour with real members)
- **ADRs:** [0001](../../adr/0001-foundational-decisions.md), [0002](../../adr/0002-transactions-table.md), [0004](../../adr/0004-background-jobs.md), [0005](../../adr/0005-encryption-at-rest.md)

## Goal

Getting transactions into Kash stops being manual. Any bank's CSV can be imported through a column-mapping wizard with reusable presets. A bank can be connected through Plaid or SimpleFIN and synced on a schedule. Everything imported or synced waits in a review queue, with duplicates flagged, until a person accepts it.

## Scope

1. **Review queue.** A staging table and UI shared by CSV import and bank sync.
2. **CSV wizard.** Upload, map columns, preview, save the mapping as a preset. Built-in and community presets ship in the repo.
3. **`BankSyncProvider` interface** in `packages/integrations`, with **Plaid** and **SimpleFIN** adapters. Self-hosters bring their own keys.
4. **Encrypted token storage** per ADR-0005, and the `rotate-keys` command.
5. **Scheduled sync** with pg-boss per ADR-0004, plus "Sync now". Introduces `WORKER_MODE`.
6. **De-duplication** against existing transactions and other staged rows.
7. Auto-categorisation of staged rows using the M1 fuzzy matcher.

## Non-scope

- Moving money, initiating payments, or any write to a bank. Sync is read-only.
- Investment holdings, loans and balances as tracked data. Only transactions are stored (the current balance is shown if the provider returns it, but not kept historically).
- Rules engines ("always categorise X as Y") beyond the existing fuzzy match.
- Other providers. The interface makes them possible; none is built now.
- OFX/QIF file import.
- A `transfer` transaction type. Transfers between a user's own accounts appear as an expense in one and an income in the other; the review queue lets the user dismiss both. If this proves painful, a later ADR extends ADR-0002.

## Data model changes

```
transactions (additions)
  source        enum('manual','csv','plaid','simplefin') not null default 'manual'
  external_id   text null                      -- provider's transaction id
  bank_account_id uuid null references bank_accounts(id) on delete set null
  unique (budget_id, source, external_id) where external_id is not null

import_presets (defined in M1; mapping shape fixed here)
  mapping jsonb:
    { "version": 1,
      "hasHeader": true, "delimiter": ",",
      "columns": { "date": "Transaction Date", "name": "Description",
                   "amount": "Amount" | null,
                   "debit": "Debit" | null, "credit": "Credit" | null },
      "dateFormat": "MM/dd/yyyy" | "auto",
      "amountSign": "positive_is_expense" | "negative_is_expense",   // when a single amount column is used
      "importIncome": false }

bank_connections
  id                 uuid pk
  budget_id          uuid not null references budgets(id) on delete cascade
  provider           enum('plaid','simplefin') not null
  institution_name   text null
  external_id        text null                 -- e.g. Plaid item id
  secret_encrypted   text not null             -- ADR-0005 format; Plaid access token or SimpleFIN access URL
  sync_cursor        text null
  status             enum('active','needs_reauth','error','disabled') not null default 'active'
  last_synced_at     timestamptz null
  last_error         text null                 -- sanitised message, never a token
  created_by         text null references user(id) on delete set null
  created_at, updated_at timestamptz

bank_accounts
  id             uuid pk
  connection_id  uuid not null references bank_connections(id) on delete cascade
  budget_id      uuid not null references budgets(id) on delete cascade   -- denormalised for scoping
  external_id    text not null
  name           text not null
  mask           text null                     -- last four digits only
  type           text null
  enabled        boolean not null default true -- sync this account or not
  unique (connection_id, external_id)

import_batches
  id          uuid pk
  budget_id   uuid not null references budgets(id) on delete cascade
  source      enum('csv','plaid','simplefin') not null
  label       text not null                    -- file name or institution
  created_by  text null references user(id) on delete set null
  created_at  timestamptz

staged_transactions
  id                     uuid pk
  budget_id              uuid not null references budgets(id) on delete cascade
  batch_id               uuid not null references import_batches(id) on delete cascade
  bank_account_id        uuid null references bank_accounts(id) on delete set null
  source                 enum('csv','plaid','simplefin') not null
  external_id            text null
  type                   enum('expense','income') not null
  name                   text not null
  amount_cents           integer not null check (amount_cents > 0)
  date                   date not null
  suggested_category_id  uuid null references categories(id) on delete set null
  status                 enum('pending','accepted','dismissed') not null default 'pending'
  duplicate_of           uuid null references transactions(id) on delete set null
  duplicate_confidence   enum('exact','likely') null
  pending_at_bank        boolean not null default false
  raw                    jsonb null            -- provider payload with account numbers removed
  transaction_id         uuid null references transactions(id) on delete set null   -- set when accepted
  created_at, updated_at timestamptz
  unique (budget_id, source, external_id) where external_id is not null
  index (budget_id, status, date desc)
```

Community presets are JSON files in `packages/core/import/presets/` using the mapping shape above plus `id`, `name` and `institution`. They are read-only and available to every budget. `CONTRIBUTING.md` explains how to add one, and a test validates every file.

## Design

### Provider interface

```ts
interface BankSyncProvider {
  id: 'plaid' | 'simplefin';
  isConfigured(): boolean;                                  // are instance credentials present
  startLink(ctx): Promise<LinkStart>;                       // what the client needs to begin connecting
  completeLink(ctx, input): Promise<{ secret: string; externalId?: string; institutionName?: string }>;
  listAccounts(secret): Promise<ProviderAccount[]>;
  sync(secret, cursor | null, since: string): Promise<{
    added: ProviderTransaction[]; modified: ProviderTransaction[]; removedIds: string[];
    nextCursor: string | null;
  }>;
  disconnect(secret): Promise<void>;
}
```

`ProviderTransaction` is normalised: `externalId`, `accountExternalId`, `date`, `name`, `amountCents` (positive), `type`, `pending`. Each adapter owns its provider's sign convention; nothing outside the adapter knows it.

- **Plaid.** Server creates a link token; the browser runs Plaid Link; the server exchanges the public token for an access token and stores it encrypted. Sync uses the cursor-based transactions sync. Instance credentials: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`. Webhooks are optional and off by default, because a home server is often not reachable from the internet; scheduled polling is the baseline. An item that needs re-login sets `needs_reauth` and the UI offers Link in update mode.
- **SimpleFIN.** The user pastes a setup token from their SimpleFIN Bridge account; the server claims it once for an access URL and stores that encrypted. Sync fetches accounts and transactions for a date window; there is no cursor, so de-duplication relies on `external_id`. No instance credentials are needed.

Check each provider's current documentation when implementing. Adapters are tested against recorded fixtures and a fake provider, never against live services in CI.

### Sync job

For each active connection (one job per connection, singleton): decrypt the secret, call `sync`, map to staged rows for enabled accounts only, upsert on `(budget_id, source, external_id)`, run duplicate detection and category suggestion, save the cursor, set `last_synced_at`. Provider `modified` updates a still-pending staged row; if the row was already accepted, the change is staged as a new row flagged as a likely duplicate of the accepted transaction so a person decides. Provider `removedIds` dismisses pending staged rows and never deletes accepted transactions. Transactions the bank marks pending are staged with `pending_at_bank` and cannot be accepted until posted. Errors are stored sanitised in `last_error`; auth errors set `needs_reauth`. The first sync fetches 90 days.

### Duplicate detection

- **Exact:** the same `(source, external_id)` already exists in `transactions`. No staged row is created for it.
- **Likely:** an existing transaction in the budget with the same type and `amount_cents`, a date within three days, and a name that matches under the M1 normaliser (exact normalised match or token-order match). The staged row is shown with the candidate and defaults to "skip".
- The same rule applies between a new staged row and other pending staged rows from a different source (for example a CSV overlapping a synced range).

### CSV wizard flow

Upload → detect delimiter and header → if a preset matches the header exactly, apply it, otherwise show the mapping step (pick the date, name and amount or debit/credit columns, date format, sign convention, whether to import income) with a live preview of the first 20 parsed rows and row issues → stage all valid rows as a batch → go to the review queue. The user can save the mapping as a named preset for the budget. The M1 preview endpoint and "fill the form" flow remain for small files.

## API endpoints

| Method | Path | Purpose | Authz |
|---|---|---|---|
| GET | `/api/v1/budgets/{budgetId}/import-presets` | Budget presets plus built-in ones (flagged `builtIn`) | Member |
| POST | `/api/v1/budgets/{budgetId}/import-presets` | Save a preset `{ name, mapping }` | Editor |
| PATCH | `/api/v1/budgets/{budgetId}/import-presets/{presetId}` | Rename or change mapping | Editor; preset must belong to the budget; built-in presets cannot be changed (`403`) |
| DELETE | `/api/v1/budgets/{budgetId}/import-presets/{presetId}` | Delete | Editor; preset must belong to the budget |
| POST | `/api/v1/budgets/{budgetId}/imports/csv/analyze` | Upload a CSV; returns headers, sample rows, detected delimiter and a matching preset if any. Writes nothing. | Editor |
| POST | `/api/v1/budgets/{budgetId}/imports/csv/stage` | Upload a CSV with a `mapping` or `presetId`; creates a batch and staged rows; returns counts and issues | Editor; `presetId` must be built-in or belong to the budget |
| GET | `/api/v1/budgets/{budgetId}/staged-transactions` | Review queue; filters `status`, `batchId`, `bankAccountId`, `duplicates` | Member |
| PATCH | `/api/v1/budgets/{budgetId}/staged-transactions/{stagedId}` | Edit a pending row before accepting: `name`, `type`, `date`, `suggestedCategoryId` | Editor; row and category must belong to the budget |
| POST | `/api/v1/budgets/{budgetId}/staged-transactions/accept` | `{ items: [{ id, categoryId? }] }`, up to 500; creates transactions and marks rows accepted, all-or-nothing | Editor; every row and category must belong to the budget; rows pending at the bank are refused (`409`) |
| POST | `/api/v1/budgets/{budgetId}/staged-transactions/dismiss` | `{ ids: [...] }` | Editor; every row must belong to the budget |
| GET | `/api/v1/budgets/{budgetId}/import-batches` | List batches with counts by status | Member |
| DELETE | `/api/v1/budgets/{budgetId}/import-batches/{batchId}` | Discard a batch's pending rows. Accepted transactions are kept. | Editor; batch must belong to the budget |
| GET | `/api/v1/bank-sync/providers` | Which providers this instance has configured | Authenticated. Returns names and availability only, never credentials. |
| GET | `/api/v1/budgets/{budgetId}/bank-connections` | List connections with accounts, status, last sync. Never returns the secret. | Member |
| POST | `/api/v1/budgets/{budgetId}/bank-connections/link/start` | `{ provider }` → what the client needs (a Plaid link token; for SimpleFIN, instructions) | Owner |
| POST | `/api/v1/budgets/{budgetId}/bank-connections/link/complete` | `{ provider }` plus `publicToken` (Plaid) or `setupToken` (SimpleFIN) → creates the connection and accounts, enqueues the first sync | Owner |
| PATCH | `/api/v1/budgets/{budgetId}/bank-connections/{connectionId}` | Enable or disable the connection or individual accounts | Owner; connection and accounts must belong to the budget |
| POST | `/api/v1/budgets/{budgetId}/bank-connections/{connectionId}/sync` | Enqueue a sync now. Rate limited to one per connection per five minutes. | Editor; connection must belong to the budget |
| POST | `/api/v1/budgets/{budgetId}/bank-connections/{connectionId}/reauth/start` | Begin re-authentication for a connection in `needs_reauth` | Owner; connection must belong to the budget |
| DELETE | `/api/v1/budgets/{budgetId}/bank-connections/{connectionId}` | Disconnect at the provider and delete the connection and its pending staged rows. Accepted transactions are kept. | Owner; connection must belong to the budget |
| POST | `/api/v1/webhooks/plaid` | Optional Plaid webhook; enqueues a sync for the item | Public endpoint, authenticated by verifying Plaid's webhook signature. Disabled (`404`) unless `PLAID_WEBHOOKS=true`. Carries no user session and can only enqueue a sync for a connection that already exists. |

Connecting a bank is owner-only because it attaches a credential for someone's bank account to a shared budget. All bank-connection endpoints return `503 encryption_not_configured` when `APP_ENCRYPTION_KEY` is absent, and `503 provider_not_configured` when the provider has no instance credentials.

New configuration: `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY_PREVIOUS`, `WORKER_MODE`, `BANK_SYNC_CRON`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOKS`. All optional; added to `docker/.env.example` and `docs/self-hosting.md`, with a section on getting Plaid development keys and a SimpleFIN setup token.

## UI

- **Import** page: upload, the mapping step with live preview, preset picker and "save as preset".
- **Review** page with a badge in the navigation showing the pending count: rows grouped by batch; each row shows date, name, amount, type, a category selector prefilled with the suggestion, and a duplicate notice with the matching transaction. Bulk select, "Accept selected", "Dismiss selected", "Accept all without duplicates". Rows pending at the bank are greyed with an explanation. On a phone this is a card list with swipe to accept or dismiss.
- **Bank connections** in budget settings: provider choice (only configured providers), the Plaid Link flow or the SimpleFIN token form, the account list with per-account toggles, status, last sync time, "Sync now", "Reconnect" when needed, and disconnect with confirmation. When encryption or a provider is not configured, the page explains what the instance admin has to set, with a link to the docs.
- Transactions show a small source marker (manual, CSV, bank).

## Acceptance tests

### Authz matrix

The M1 matrix extends to every endpoint above with a `{budgetId}`. In addition:

- `M5-AZ-1` A viewer can read the review queue and connections and cannot accept, dismiss, stage, sync or connect.
- `M5-AZ-2` An editor cannot start or complete a link, re-authenticate, change or delete a connection (`403`).
- `M5-AZ-3` Accepting with staged row IDs from budget B through budget A's path → `404`, nothing written in either budget.
- `M5-AZ-4` Accepting with a `categoryId` from another budget → `422`.
- `M5-AZ-5` Using a `presetId`, `batchId` or `connectionId` from budget B under budget A's path → `404`.
- `M5-AZ-6` No endpoint response, log line or error message contains a bank secret (tests search responses and captured logs for the fixture token strings).
- `M5-AZ-7` The Plaid webhook with a missing or invalid signature → `401` and no job enqueued; with webhooks disabled → `404`.
- `M5-AZ-8` The sync job for a connection only ever writes rows with that connection's `budget_id` (asserted with two budgets connected to the fake provider).

### Unit (Vitest)

- `M5-U-1` Mapping engine: single amount column with each sign convention; debit and credit columns; income imported or skipped; each date format; missing mapped column → a clear issue.
- `M5-U-2` Every built-in and community preset file validates against the mapping schema and parses its own fixture CSV to the expected rows.
- `M5-U-3` Delimiter and header detection for comma, semicolon and tab files, with and without a byte-order mark.
- `M5-U-4` Duplicate detection: exact by external ID; likely by amount, date window and name; not flagged when the amount differs by one cent or the date by four days.
- `M5-U-5` Encryption: round trip; wrong purpose fails; wrong AAD (another row ID) fails; tampered ciphertext fails; a value encrypted with the previous key decrypts; `rotate-keys` re-encrypts everything to the current key; a key of the wrong length is rejected at startup.
- `M5-U-6` Plaid adapter against recorded fixtures: added, modified and removed are mapped; signs are normalised to positive amounts with the right type; pending is carried.
- `M5-U-7` SimpleFIN adapter against recorded fixtures: token claim, account list, transactions for a window, sign normalisation.
- `M5-U-8` Sync job against the fake provider: first sync stages rows; a second identical sync stages nothing new; a modified pending transaction updates its staged row; a removal dismisses a pending row and leaves an accepted transaction alone; an auth error sets `needs_reauth`; a transient error leaves status active and records `last_error` without the secret.

### API behaviour (Vitest)

- `M5-API-1` CSV: analyze → stage with a custom mapping → rows are in the queue with suggested categories → accept → transactions exist with `source = 'csv'`, and the staged rows are accepted and linked.
- `M5-API-2` Staging the same CSV twice flags the second batch's rows as likely duplicates of the accepted transactions.
- `M5-API-3` Accept is all-or-nothing: one invalid item → nothing accepted.
- `M5-API-4` Deleting a batch removes pending rows and keeps accepted transactions.
- `M5-API-5` Full fake-provider flow: start link → complete link → the secret column holds ciphertext in the `v1.` format and not the token → first sync job stages rows → accept.
- `M5-API-6` Without `APP_ENCRYPTION_KEY`, bank-connection endpoints return `503 encryption_not_configured` and CSV import still works.
- `M5-API-7` "Sync now" twice within five minutes → the second is refused with `429`.
- `M5-API-8` Disabling an account stops its transactions being staged on the next sync.
- `M5-API-9` Disconnect calls the provider's disconnect, deletes the connection and pending rows, and keeps accepted transactions with `bank_account_id` set to null.
- `M5-API-10` A row pending at the bank cannot be accepted; after a sync marks it posted, it can.

### End to end (Playwright)

- `M5-E-1` Upload an unfamiliar CSV → map columns → preview updates as the mapping changes → save as preset → review → accept all → the dashboard reflects the new expenses.
- `M5-E-2` Upload a second file with the same header → the saved preset is applied automatically and the mapping step is skipped.
- `M5-E-3` With the fake provider enabled in the test environment: connect → choose accounts → sync → review queue shows rows, including one flagged as a likely duplicate of a manually entered expense → dismiss the duplicate, accept the rest.
- `M5-E-4` With no encryption key, the connections page shows the "not configured" explanation instead of provider buttons.

### Manual (recorded in the devlog)

- `M5-M-1` A real Plaid connection in Plaid's sandbox or development environment, and a real SimpleFIN connection, each synced and reviewed on the owner's instance.

## Demo end state

The owner drops in a CSV from a bank Kash has never seen, maps three columns, and has it imported; next month it takes one click. A bank account is connected with the owner's own Plaid keys or a SimpleFIN token; overnight, new transactions appear in the review queue, already categorised where Kash recognises the merchant, with a duplicate of something entered by hand flagged. A database dump shows no readable bank token.

## Devlog prompt

Film and write: the wizard on an ugly real-world CSV; connecting a real bank on a self-hosted box and what it costs and takes to get Plaid keys as an individual, versus SimpleFIN; the review queue catching a duplicate. Open the database on camera and show the encrypted token. Cover where the agent's adapter disagreed with the provider's real behaviour (sign conventions, pending transactions) and how fixtures caught or missed it.

## Locked decisions covered

Bank sync (provider interface, Plaid and SimpleFIN, bring your own keys, read-only, review queue), CSV (mapping wizard, saved and community presets, fuzzy auto-categorise).
