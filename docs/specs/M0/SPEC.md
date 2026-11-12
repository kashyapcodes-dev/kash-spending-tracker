# M0: Foundations and build-in-public setup

- **Status:** In progress. The documentation part was done in the bootstrap session ([devlog 0001](../../devlog/0001-bootstrap.md)); the tooling part is not started.
- **Depends on:** nothing
- **ADRs:** [0001](../../adr/0001-foundational-decisions.md)

## Goal

An empty but fully wired monorepo: every package from the target layout exists, and lint, typecheck, unit tests, end-to-end tests and CI all run and pass on a trivial example. After M0, an agent can start M1 without making any tooling decision.

## Scope

1. **Repository documents** (done): `README.md`, `LICENSE` (AGPL-3.0), `CLAUDE.md`, `AGENTS.md`, `.gitignore`, ADR and devlog templates, ADR-0001 to ADR-0005, specs M0 to M8.
2. **Workspace.** pnpm workspaces and Turborepo. Root `package.json` with `packageManager` pinned, `engines.node` set to the current Node LTS, and `.nvmrc`.
3. **Packages.** Each directory below exists with a `package.json`, a `tsconfig.json` extending a shared base, a `src/index.ts`, and one passing Vitest test:
   - `apps/web`: a Next.js App Router app (TypeScript, Tailwind, shadcn/ui initialised) with one page that renders the app name, and a `GET /api/v1/health` route handler returning `{ "status": "ok" }`.
   - `apps/mcp`: package stub only.
   - `packages/db`, `packages/core`, `packages/contract`, `packages/api-client`, `packages/ui`, `packages/integrations`: stubs. `packages/contract` has zod installed and exports the health response schema, which `apps/web` uses, proving cross-package imports work.
   - `packages/config`: shared TypeScript, ESLint and Vitest configuration. (An addition to the target layout; tooling only.)
4. **TypeScript.** `strict: true`, `noUncheckedIndexedAccess: true`. No JavaScript source files.
5. **Lint and format.** ESLint flat config and Prettier, including:
   - an import-boundary rule enforcing the dependency direction in `CLAUDE.md` (`core` must not import from `apps/*` or `next`; `contract` must not import internal packages);
   - a rule forbidding `.js` and `.jsx` source files.
6. **Tests.** Vitest configured per package with a root `pnpm test`. Playwright configured in `apps/web` with one test that loads the home page and one that calls the health endpoint. Playwright starts the built app itself.
7. **Scripts.** Root scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `format`, `format:check`, each running through Turborepo with caching.
8. **CI.** `.github/workflows/ci.yml` on pull requests and pushes to `main`: install with a frozen lockfile, then lint, typecheck, test, build and Playwright. A `docker-build` job exists and is skipped with a clear message until `docker/Dockerfile` appears in M2.
9. **Repository hygiene.** Pull request template with an "acceptance tests satisfied" checklist, issue templates (bug, proposal), `CONTRIBUTING.md` (how specs, ADRs and the devlog work; contributions are AGPL-3.0), `SECURITY.md` (how to report a vulnerability privately), Dependabot or Renovate configuration.
10. **Update `CLAUDE.md`** so its Commands section matches the real scripts.

## Non-scope

- Any database, auth or domain code (M1).
- Docker (M2).
- Deployment of any kind.
- Choosing libraries for later milestones.

## Data model changes

None.

## API endpoints

| Method | Path | Purpose | Authz |
|---|---|---|---|
| GET | `/api/v1/health` | Liveness. Returns `200 { "status": "ok" }`. Extended in M2 with a database check. | Public. Returns no user or system detail. |

## UI

One placeholder home page showing the name "Kash" and a link to the repository. No styling work beyond confirming Tailwind and one shadcn component render.

## Acceptance tests

Tooling (run in CI; each is a job step that must pass):

- `M0-CI-1` `pnpm install --frozen-lockfile` succeeds on a clean checkout.
- `M0-CI-2` `pnpm lint` passes, and fails when a file in `packages/core` imports from `next` (prove with a fixture test of the ESLint rule, not by breaking the build).
- `M0-CI-3` `pnpm typecheck` passes with strict settings.
- `M0-CI-4` `pnpm test` runs at least one test in every package and passes.
- `M0-CI-5` `pnpm build` produces a Next.js build.
- `M0-CI-6` `pnpm test:e2e` passes.

Vitest:

- `M0-U-1` `packages/contract`: the health schema parses `{ status: "ok" }` and rejects `{ status: 1 }`.
- `M0-U-2` `apps/web`: the health route handler returns status 200 and a body that parses with the contract schema.

Playwright:

- `M0-E-1` The home page loads and shows "Kash".
- `M0-E-2` `GET /api/v1/health` returns 200 and `{ "status": "ok" }`.

Repository checks (a script, `pnpm check:repo`, run in CI):

- `M0-R-1` No `.js`, `.jsx` or `.mjs` source files under `apps/*/src`, `apps/*/app` or `packages/*/src` (configuration files at package roots are exempt).
- `M0-R-2` Every relative link in `README.md`, `CLAUDE.md` and `docs/**/*.md` resolves to an existing file.
- `M0-R-3` Every `docs/specs/M*/SPEC.md` contains the required section headings listed in [the spec format](../README.md#spec-format).
- `M0-R-4` `LICENSE` begins with "GNU AFFERO GENERAL PUBLIC LICENSE".

## Demo end state

On a clean clone: `pnpm install && pnpm dev` shows the placeholder page; `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` are all green; a pull request shows the CI workflow passing.

## Devlog prompt

Film and write: why start from specs instead of code; a walk through ADR-0001 and what each decision rules out; the first agent session scaffolding the monorepo from this spec, including anything it got wrong (version mismatches, config it invented, tests that passed for the wrong reason); the first green CI run. Show the spec next to the diff.

## Locked decisions covered

Repo, Licence, Quality (tooling and CI), Content workflow.
