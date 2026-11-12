# ADR-0001: Foundational decisions

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone:** M0

## Context

Kash starts as a rewrite of a private personal budgeting app. That app runs on Vercel and hosted Supabase, was built from the Next.js Supabase starter, and has these properties that shaped the decisions below:

- Mixed JavaScript and TypeScript, no tests, no CI, no Docker, no `.env.example`.
- No schema, migrations or access policies in the repository. Authorization depends entirely on row-level security rules that live only in the hosted database. Some routes filter by date only, update by ID only, or trust a budget ID sent by the client.
- Every page uses the user's first budget. No budget is created on signup. There is no edit or delete for expenses or incomes.
- Useful logic exists and is worth keeping: CSV parsing with fuzzy auto-categorisation, a two-period comparison report, and dashboard aggregation.

The goals for the rewrite are: a public project built in the open, self-hosting with Docker on personal hardware, a hosted paid version later from the same code, one backend for web and mobile, and new features (bank sync, an AI agent, custom dashboards).

The owner made the decisions below before any spec was written. Specs and agents implement them and do not re-open them.

## Decision

| Area | Decision | Why |
|---|---|---|
| Repo | A fresh public monorepo using Turborepo and pnpm. The original repo stays private as a reference and as the live deployment until cutover. | A clean history with no personal data; the old code has too many starter leftovers to open up. |
| Licence | AGPL-3.0, one repository. Hosted features are toggled by configuration. | Anyone may self-host; anyone who runs a modified service must share the changes. No separate proprietary edition to maintain. |
| Backend | Postgres, Drizzle ORM and Better Auth. No Supabase dependency. Authorization is enforced in application code in a service layer, and every query is scoped by budget membership. | Self-hosting must be one app container and one database. Authorization that is in the repo can be read, reviewed and tested. |
| API | Versioned REST under `/api/v1/*` in Next.js route handlers. Zod contracts generate the OpenAPI document. A shared typed client package is generated from the contract. | One backend for web, PWA, AI tools and MCP, with a contract that tools and people can read. |
| Mobile | PWA first: installable, with read views that tolerate being offline. A native app (Expo) is a future milestone that reuses the API client. | Gets a phone experience without a second codebase. |
| Tenancy | A user owns multiple budgets. A budget can be shared with a partner or family by invite. Roles: owner, editor, viewer. | Household budgeting is the real use case. |
| Bank sync | A `BankSyncProvider` interface with a Plaid adapter (bring your own keys when self-hosting) and a SimpleFIN adapter as a low-cost alternative. CSV import remains. Sync is read-only, and synced transactions land in a review queue before they become real transactions. | Self-hosters cannot share one Plaid account; the review queue keeps bad data out. |
| CSV | A column-mapping wizard with saved presets. Community presets ship in the repo. No parser for one person's bank export. Fuzzy auto-categorisation is kept. | Hard-coded per-bank parsers do not scale to other users. |
| AI | A pluggable provider (AI SDK style) with Claude as the default, and OpenAI and Ollama supported. Capabilities: read-only Q&A; writes as proposed diffs that need user confirmation; widget generation as a declarative JSON spec with no code execution; and an MCP server exposing the same tools. | Useful without being trusted with money data unsupervised. |
| Dashboards | A widget registry (stat, pie, bar, line, table, budget versus actual and more) with per-user saved layouts using react-grid-layout. AI-generated widgets use the identical spec. | One rendering path for hand-built and generated widgets. |
| Billing | Deferred. Specs only reserve a `HOSTED_MODE` flag and plan and entitlement seams. | Not needed until there is something worth charging for. |
| Migration | A one-time script from a Supabase dump to the new schema. Auth users are imported with their password hashes if Better Auth can verify bcrypt, otherwise with a forced reset. | The owner's own data must survive the move. |
| Quality | Vitest unit tests, Playwright end-to-end tests, authorization tests for every endpoint (user A cannot touch budget B), GitHub Actions for lint, typecheck, test and docker build, and `CLAUDE.md` / `AGENTS.md`. | Agents write the code, so the checks have to be mechanical. |
| Content workflow | A milestone is an episode. Each milestone has a `SPEC.md` that agents implement against, with tests as acceptance. `docs/devlog/` and ADRs record prompts, decisions and agent mistakes. Public from day one. | The project exists to show what trusting agents with development looks like. |

Sequencing: the open-source, self-hostable foundation comes first (M0 to M3). Everything else builds on it.

## Alternatives considered

- **Open up the existing repo.** Rejected: history contains personal parsers and starter clutter, and authorization cannot be reviewed because it is not in the repo.
- **Keep Supabase and ship its self-hosted stack.** Rejected: self-hosting Supabase means many containers, which defeats "lightweight on personal hardware".
- **MIT or Apache-2.0.** Rejected: allows a closed hosted fork. The repository was first created on GitHub with an Apache-2.0 licence file; that file was replaced with AGPL-3.0 before any other content was added.
- **Open core with a proprietary hosted edition.** Rejected: two codebases to keep in step.
- **Native mobile app first.** Rejected: a second client before the API is stable.
- **tRPC or server actions as the API.** Rejected: MCP, a future native app and third parties need a plain HTTP contract.

## Consequences

- Authorization is the project's responsibility in full. The per-endpoint authz test suite is mandatory, not optional.
- Self-hosters need only Docker. Email, bank sync and AI are optional and off without configuration.
- Hosted mode must be built as configuration over the same code, which constrains how hosted-only features are designed (M8).
- Questions this ADR left open are resolved in ADR-0002 (transactions table), ADR-0003 (widget query DSL), ADR-0004 (background jobs) and ADR-0005 (encryption at rest).
