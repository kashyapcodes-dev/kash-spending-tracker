# Kash documentation

| Folder | Contents |
|---|---|
| [specs/](specs/README.md) | One `SPEC.md` per milestone. Agents implement against these; the acceptance tests define done. |
| [adr/](adr/) | Architecture decision records. [ADR-0001](adr/0001-foundational-decisions.md) holds the decisions that are not open for debate. |
| [devlog/](devlog/) | One entry per working session: prompts, decisions, agent mistakes. |

`self-hosting.md` is added in M2.

## ADR index

| ADR | Decision |
|---|---|
| [0001](adr/0001-foundational-decisions.md) | Foundational decisions: stack, licence, tenancy, API, AI, workflow |
| [0002](adr/0002-transactions-table.md) | One `transactions` table; money as integer cents; calendar dates |
| [0003](adr/0003-widget-query-dsl.md) | Widget query DSL: a closed, budget-scoped JSON shape |
| [0004](adr/0004-background-jobs.md) | Background jobs with pg-boss, in-process by default |
| [0005](adr/0005-encryption-at-rest.md) | Encryption at rest with `APP_ENCRYPTION_KEY` and AES-256-GCM |
