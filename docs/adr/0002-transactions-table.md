# ADR-0002: One transactions table, integer cents, calendar dates

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone:** M1

## Context

The original app has two tables, `expenses(id, budget_id, category_id, name, amount, date)` and `incomes(id, budget_id, name, amount, date)`. They differ only in that incomes have no category. Amounts are decimal dollars that the code parses with `parseFloat`. Dates are stored as dates, but the code moves them through JavaScript `Date` objects, and the CSV importer contains a workaround so that a calendar day does not shift across time zones.

Later milestones need to treat money movement uniformly: bank sync delivers debits and credits in one feed, the widget query DSL (ADR-0003) wants one source to filter and group, and the AI tools want one thing to query.

## Decision

### One table with a type

```
transactions
  id            uuid primary key
  budget_id     uuid not null references budgets(id) on delete cascade
  type          enum('expense', 'income') not null
  category_id   uuid null references categories(id) on delete set null
  name          text not null            -- 1 to 500 characters
  amount_cents  integer not null check (amount_cents > 0)
  date          date not null
  notes         text null
  created_by    text null references user(id) on delete set null
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()

  index (budget_id, date desc)
  index (budget_id, type, date desc)
  index (budget_id, category_id)
```

- `amount_cents` is always positive. The `type` gives the direction. There are no negative amounts.
- Income may have a category but does not need one. Expenses may be uncategorised (`category_id` null), which reports show as "Uncategorized", as the original compare report does.
- The UI keeps separate Expenses and Incomes pages. They are filtered views of the same endpoint.

### Money

- Stored as integer minor units (cents) in `amount_cents`.
- Sent over the API as an integer field named `amountCents`. Clients format for display.
- A budget has one currency, `budgets.currency` (ISO 4217, default `USD`). Mixed currencies within a budget are out of scope.
- Parsing user or CSV input into cents happens in one function in `packages/core` (ported from `parseMoney` in the original importer: handles `$`, thousands separators, parentheses for negatives and a leading minus), which works on the string and never goes through a float.
- Averages and per-day figures are computed from integer sums and rounded to the nearest cent at the end, half away from zero.

### Dates

- `date` is a Postgres `date`. Over the API it is a `YYYY-MM-DD` string. It is never turned into a JavaScript `Date` with a time zone on the way in or out.
- Range filters are inclusive on both ends. A period's day count is inclusive (`to - from + 1`), as in the original compare report. The original dashboard's per-day figure used a non-inclusive count and divided by zero for a one-day range; that is a bug and is not ported.

### Identifiers

- Domain tables use UUID primary keys. Auth tables use whatever ID type Better Auth generates.
- The original integer IDs are not kept. The migration (M3) produces an old-to-new mapping in its report.

## Alternatives considered

- **Separate `expenses` and `incomes` tables.** Matches the old shape and makes migration trivial, but every later feature (sync, widgets, AI, dedupe) would need unions or duplicate code.
- **One table with signed amounts and no type.** Compact, but the sign convention is a constant source of bugs at import boundaries, where banks disagree about which direction is positive.
- **`numeric(12,2)` for money.** Exact in the database, but it arrives in JavaScript as a string or a float and invites `parseFloat`. Integers are exact everywhere.
- **Decimal strings in the API.** Readable, but every client must parse them. An integer cannot be misread.
- **Transfers as a third type.** Useful once several bank accounts are synced. Deferred to M5, which may add `transfer` to the enum by a new ADR.

## Consequences

- One CRUD surface and one authz test matrix for all money movement.
- All clients must convert cents for display; `packages/ui` provides the formatter.
- The migration must convert decimal dollars to cents and verify totals to the cent (M3).
- Currencies with no minor unit or with three decimal places work because the exponent comes from the currency code, not from an assumption of two places.
