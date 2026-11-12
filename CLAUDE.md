# CLAUDE.md

Instructions for AI agents working in this repository. Humans should read it too.

## What this project is

Kash is an open-source (AGPL-3.0), self-hostable budgeting app, built in public. Agents implement it milestone by milestone against written specs. See [README.md](README.md) for the overview.

## How work is done here

1. **Work from the spec.** Every change belongs to a milestone in `docs/specs/M{n}/SPEC.md`. Read the spec and the ADRs it cites before writing code. The acceptance tests in the spec define "done".
2. **Do not re-open locked decisions.** [ADR-0001](docs/adr/0001-foundational-decisions.md) records decisions the owner has made. If a spec or an ADR seems wrong, stop and say so; do not work around it silently.
3. **Record new decisions as ADRs.** A choice that a future contributor would otherwise have to rediscover (a library, a data shape, a trade-off) gets a new file in `docs/adr/` using the template. Number them in order. Never edit an accepted ADR's decision; supersede it with a new one.
4. **Write the devlog.** Each working session adds or extends an entry in `docs/devlog/` using the template: the prompts given, what was decided, what the agent got wrong and how it was caught. Mistakes are content here. Do not tidy them away.
5. **Keep the spec truthful.** If implementation shows a spec is wrong or incomplete, update the spec in the same pull request and note it in the devlog.

## Non-negotiable rules

- **Authorization lives in the service layer.** Every domain function in `packages/core` takes an actor and a budget ID and checks membership and role before touching data. Route handlers never query the database directly. A client-supplied budget ID is never trusted without that check.
- **Every endpoint has authz tests.** For each `/api/v1` endpoint there is a test proving that a user who is not a member of the budget gets `404`, and that a member whose role is too low gets `403`.
- **No Supabase.** No Supabase client, no PostgREST, no row-level security as the only guard. Postgres through Drizzle only.
- **One contract.** Request and response shapes are zod schemas in `packages/contract`. The OpenAPI document and the typed client are generated from them. Do not hand-write types that duplicate a contract.
- **TypeScript only, strict mode.** No `.js` or `.jsx` source files. No `any` without a comment explaining why.
- **Money is integer minor units.** Amounts are stored and sent as integer cents. Never use floating point for money. See [ADR-0002](docs/adr/0002-transactions-table.md).
- **Dates of transactions are calendar dates** (`YYYY-MM-DD`), not timestamps. Never convert them through a time zone.
- **Secrets never reach the repo, logs or the client.** Bank tokens and AI keys are encrypted at rest as described in [ADR-0005](docs/adr/0005-encryption-at-rest.md).
- **The AI agent never writes directly.** Agent writes are proposals that a user approves. Generated widgets are declarative JSON; nothing the model produces is executed as code.
- **Self-host must keep working.** Nothing may require a hosted third-party service to boot. Hosted-only behaviour sits behind `HOSTED_MODE`.

## Stack

| Concern | Choice |
|---|---|
| Monorepo | Turborepo, pnpm workspaces |
| Web | Next.js App Router, React, Tailwind, shadcn/ui, recharts |
| API | Next.js route handlers under `/api/v1`, zod contracts, generated OpenAPI |
| Database | Postgres, Drizzle ORM and drizzle-kit migrations |
| Auth | Better Auth |
| Jobs | pg-boss ([ADR-0004](docs/adr/0004-background-jobs.md)) |
| Tests | Vitest (unit and API), Playwright (end to end) |
| CI | GitHub Actions: lint, typecheck, test, docker build |

Library versions are chosen at implementation time (latest stable) and pinned in the lockfile. Check the library's current documentation before using an API; do not rely on memory for Better Auth, Drizzle, pg-boss, Plaid or SimpleFIN details.

## Target layout

```
apps/web               Next.js: UI and /api/v1 route handlers, PWA manifest and service worker
apps/mcp               MCP server (thin wrapper over api-client)
packages/db            Drizzle schema, migrations, seed
packages/core          domain services: authz, budgets, transactions, reports, import, aggregation
packages/contract      zod schemas and OpenAPI generation
packages/api-client    typed client generated from contract
packages/ui            shadcn components, widget registry and renderers
packages/integrations  bank-sync providers, AI providers
tools/                 one-off CLIs (for example the Supabase migration)
docs/                  specs/, adr/, devlog/, self-hosting.md
docker/                Dockerfile, compose.yml, .env.example
```

Dependency direction: `apps/*` → `core` → `db`. `contract` depends on nothing internal. `core` must not import from `apps/*` or from Next.js.

## Commands

The repo has no code yet. M0 adds these, and this section must be updated when it does:

```
pnpm install
pnpm dev          # run the web app
pnpm lint
pnpm typecheck
pnpm test         # Vitest
pnpm test:e2e     # Playwright
pnpm db:generate  # drizzle-kit: create a migration from schema changes
pnpm db:migrate
```

## Before you say a task is done

- Lint, typecheck and tests pass locally, and you ran them.
- New endpoints have contract schemas, authz tests and an entry in the spec.
- Schema changes have a generated migration committed with them.
- The devlog entry for the session is written.
- You report what you did not do or could not verify.

## Commits and pull requests

- Conventional commit prefixes: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`.
- Reference the milestone in the scope, for example `feat(m1): add transaction CRUD`.
- One logical change per pull request. The description lists which acceptance tests it satisfies.
