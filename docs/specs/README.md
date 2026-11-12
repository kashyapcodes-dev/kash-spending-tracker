# Specs

Kash is built milestone by milestone. Each milestone has one `SPEC.md` that an agent implements against, and one episode on kashyap.codes. A milestone is done when its acceptance tests pass in CI and its demo end state can be shown.

## Milestones

| | Milestone | Depends on | Detail level |
|---|---|---|---|
| [M0](M0/SPEC.md) | Foundations and build-in-public setup | none | Implementation-ready |
| [M1](M1/SPEC.md) | Core rebuild on Postgres, Drizzle and Better Auth | M0 | Implementation-ready |
| [M2](M2/SPEC.md) | Self-host packaging | M1 | Implementation-ready |
| [M3](M3/SPEC.md) | Migration and cutover | M1, M2 | Implementation-ready |
| [M4](M4/SPEC.md) | Sharing and PWA | M1, M2 | Complete; revise after M3 |
| [M5](M5/SPEC.md) | Import and bank sync | M1, M2 | Complete; revise after M4 |
| [M6](M6/SPEC.md) | Widgets and dashboards | M1 | Complete; revise after M5 |
| [M7](M7/SPEC.md) | AI agent | M1, M6 | Complete; revise after M6 |
| [M8](M8/SPEC.md) | Hosted mode (before billing) | M2, M4, M5, M7 | Complete; most likely to change |

The first four are sequenced: foundation, core, packaging, cutover. After M3 the owner is using Kash for real, and M4 to M7 can be reordered if priorities change. M8 comes last.

## Spec format

Every `SPEC.md` has a header (status, dependencies, ADRs) and these sections, with these exact headings:

- `## Goal`: what is true when the milestone is done, in a paragraph.
- `## Scope`: numbered list of what is built.
- `## Non-scope`: what is deliberately left out, so an agent does not build it.
- `## Data model changes`: tables and columns, or "None".
- `## API endpoints`: a table of method, path, purpose and **authz rule**. Every endpoint has an authz rule, including public ones, which say why they are safe to be public.
- `## UI`: screens and behaviour.
- `## Acceptance tests`: named test cases with IDs (`M{n}-{group}-{number}`) grouped as authz, unit, API, end to end, and manual where unavoidable. Tests are the definition of done.
- `## Demo end state`: what can be shown on camera.
- `## Devlog prompt`: what to film and write for the episode.
- `## Locked decisions covered`: which rows of ADR-0001 the milestone delivers.

Specs may add sections (Design, Configuration, Ported logic) between these.

Test ID groups: `AZ` authorization, `U` unit, `API` API behaviour, `I` integration, `E` end to end, `D` container, `MCP`, `O` operations, `M` manual, `CI`, `R` repository, `DOC`, `A` auth.

## Rules that apply to every milestone

1. **Authz matrix.** Every endpoint with a `{budgetId}` is added to the generated authz test table from M1 (`M1-AZ-1` to `M1-AZ-7`): no session → `401`; non-member → `404`; role too low → `403`; child ID from another budget → `404`; foreign reference in a body → `422`. A meta-test fails the build if an endpoint is missing from the table.
2. **Contract first.** New endpoints start as zod schemas in `packages/contract`; the OpenAPI document and client are regenerated.
3. **Both ways of running.** Every feature works in self-host with no optional service configured, or is hidden with an explanation.
4. **Spec changes travel with code.** If implementation shows a spec is wrong, the pull request updates the spec and the devlog says why.
5. **Open questions become ADRs.** Specs name the choices left to implementation time (for example a service-worker library, or whether to use a multi-provider AI SDK). Each gets an ADR when it is made.

## Locked decisions to milestones

Every row of the decision table in [ADR-0001](../adr/0001-foundational-decisions.md), and where it is delivered.

| Decision | Delivered in | How |
|---|---|---|
| Repo: fresh public monorepo, Turborepo and pnpm | M0 | Workspace, packages, tooling |
| Licence: AGPL-3.0, one repo, hosted by configuration | M0, M2, M8 | Licence file; source link in the app footer; `HOSTED_MODE` with no private code |
| Backend: Postgres, Drizzle, Better Auth; authz in the service layer | M1, M2, M3 | Schema and services; one app container plus Postgres; leaving Supabase |
| API: versioned REST, zod contracts, OpenAPI, typed client | M1, M7 | `/api/v1`, generated document and client; MCP and AI tools use the same API |
| Mobile: PWA first, native later | M4 | Manifest, service worker, offline read views, mobile layouts |
| Tenancy: multiple budgets, sharing, owner / editor / viewer | M1, M4 | Data model and role enforcement; invites and member management |
| Bank sync: provider interface, Plaid and SimpleFIN, read-only, review queue | M5, M8 | Adapters, encrypted tokens, scheduled sync, review queue; managed keys when hosted |
| CSV: mapping wizard, presets, community presets, fuzzy categorise | M1, M5 | Ported parser and matcher with built-in presets; wizard and saved presets |
| AI: pluggable provider, Claude default, Q&A, confirmed writes, widgets, MCP | M7, M8 | Providers, tools, proposals, chat, MCP server; usage limits when hosted |
| Dashboards: widget registry, saved layouts, one spec for AI | M6, M7 | Registry, grid editor, templates; `create_widget` emits the same spec |
| Billing: deferred; flag and seams only | M8 | `HOSTED_MODE`, entitlements, `BillingProvider` interface with a static implementation |
| Migration: one-time Supabase script, auth import | M3 | CLI with dry run and verification report; bcrypt import or forced reset |
| Quality: Vitest, Playwright, authz tests per endpoint, CI, agent docs | M0, M1, then all | Tooling and CI; authz matrix; every later spec extends it |
| Content workflow: milestone = episode, specs, devlog, ADRs, public | M0, then all | Templates and this folder; a devlog prompt in every spec |

Open questions from the plan, resolved by ADR: transactions table ([0002](../adr/0002-transactions-table.md), used from M1), widget query DSL ([0003](../adr/0003-widget-query-dsl.md), M6), background jobs ([0004](../adr/0004-background-jobs.md), M5), encryption at rest ([0005](../adr/0005-encryption-at-rest.md), M5).
