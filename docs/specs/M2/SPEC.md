# M2: Self-host packaging

- **Status:** Not started
- **Depends on:** M1
- **ADRs:** [0001](../../adr/0001-foundational-decisions.md), [0004](../../adr/0004-background-jobs.md) (deployment shape only)

## Goal

Someone with Docker and nothing else can run Kash on their own hardware: copy an example environment file, run `docker compose up`, sign up and add an expense. Upgrades migrate the database on their own, and there is a documented way to back up and restore.

## Scope

1. **`docker/Dockerfile`.** Multi-stage build producing the Next.js standalone server. Runs as a non-root user. Builds for `linux/amd64` and `linux/arm64` (a Raspberry Pi or a small home server is a target). Uses Turborepo's prune so the build context holds only what `apps/web` needs.
2. **`docker/compose.yml`.** Services:
   - `app`: the image, port `3000`, depends on a healthy `db`.
   - `db`: Postgres (current stable major, pinned) with a named volume and a healthcheck.
   - `mailpit` under the compose profile `mail`: a local SMTP catcher for trying email flows. Off by default.
   The file works both with a locally built image (`build:`) and with the published image (`image:`), chosen by an environment variable with the published image as default.
3. **`docker/.env.example`.** Every variable the app reads, with a comment and a safe default or a generation command. See [Configuration](#configuration).
4. **Configuration module.** One zod-validated environment schema in `packages/core/config`. The app refuses to start with a clear message naming the variable when a required value is missing or malformed. No other code reads `process.env`.
5. **Migrate on boot.** The container entrypoint runs pending Drizzle migrations before starting the server, guarded by a Postgres advisory lock so two instances starting together do not race. `AUTO_MIGRATE=false` disables it; `pnpm db:migrate` (and the same command inside the container) runs migrations by hand.
6. **Health.** `GET /api/v1/health` gains a database check. The compose healthcheck and the Dockerfile `HEALTHCHECK` use it.
7. **Signup control.** `SIGNUP_MODE`: `open` (default), or `closed` (no new accounts; the signup page says so). The first account can always be created so a fresh install is never locked out.
8. **Email.** SMTP settings are optional. Without them, password-reset links are written to the app log (as in M1) and the UI says email is not configured.
9. **Image publishing.** A GitHub Actions workflow builds and pushes the multi-arch image to GitHub Container Registry on version tags (`v*`) and pushes `edge` from `main`. The CI `docker-build` job from M0 now builds the image on every pull request without pushing.
10. **`docs/self-hosting.md`.** Requirements, quick start, configuration reference, putting it behind a reverse proxy with TLS (one worked example with Caddy), upgrading, backup and restore, troubleshooting.
11. **Backups.** A documented `pg_dump` command and restore procedure, plus `docker/backup.sh`, a small script that writes a timestamped dump to a mounted directory and prunes old ones. The doc states that `APP_ENCRYPTION_KEY` (from M5 on) must be backed up separately.

## Non-scope

- Kubernetes manifests, Helm charts, one-click cloud templates.
- Built-in TLS termination. The doc covers a reverse proxy.
- Automated off-site backups.
- Bank sync and AI configuration (M5, M7). Their variables are added to `.env.example` in those milestones.
- A separate worker service. `WORKER_MODE` is introduced in M5.

## Data model changes

None. Migrations from M1 are applied by the entrypoint.

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | yes | set by compose | Postgres connection string |
| `APP_URL` | yes | `http://localhost:3000` | Public base URL; used in emailed links and for origin checks |
| `AUTH_SECRET` | yes | none | Secret for Better Auth; `.env.example` shows `openssl rand -base64 32`. The app refuses to start with the placeholder value. |
| `AUTO_MIGRATE` | no | `true` | Run migrations on boot |
| `SIGNUP_MODE` | no | `open` | `open` or `closed` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no | unset | Outgoing email |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `POSTGRES_PASSWORD` | yes (compose) | none | Used by the `db` service and interpolated into `DATABASE_URL` |

Use the exact secret variable name Better Auth expects if it differs; record it in the self-hosting doc.

## API endpoints

| Method | Path | Purpose | Authz |
|---|---|---|---|
| GET | `/api/v1/health` | `200 { "status": "ok", "db": "ok", "version": "<app version>" }`, or `503 { "status": "degraded", "db": "down" }` when the database is unreachable | Public. Exposes only status and version: no host names, no error text, no configuration. |
| GET | `/api/v1/config` | Public instance settings the UI needs before login: `{ "signupMode", "emailConfigured" }` | Public. Contains no secrets and nothing user-specific. |

## UI

- Signup page shows "Signups are closed on this instance" when `SIGNUP_MODE=closed` and an account exists.
- Forgot-password page shows a notice when email is not configured.
- Footer shows the app version and a link to the source, which also satisfies the AGPL requirement to offer the source to users of a network service.

## Acceptance tests

Container tests (a CI job that runs compose; scripted in `docker/test/`):

- `M2-D-1` From a clean checkout, `cp docker/.env.example docker/.env`, fill the generated secrets by script, `docker compose up -d --wait` → all services healthy within 120 seconds.
- `M2-D-2` Against that stack, the Playwright smoke test passes: sign up → add an expense → the expense appears on the dashboard. **This is the milestone's headline acceptance test.**
- `M2-D-3` `docker compose down` then `up` again (volume kept) → the user can sign in and the expense is still there.
- `M2-D-4` Start with an empty database → migrations are applied on boot and the health endpoint reports `db: ok`. Start again → no migration runs and startup succeeds.
- `M2-D-5` Start two `app` containers at once against an empty database → both become healthy; the migration table shows each migration once.
- `M2-D-6` Start `app` with `AUTH_SECRET` unset or left as the placeholder → the container exits non-zero and the log names the variable.
- `M2-D-7` Stop `db` while `app` runs → health returns `503`; start `db` → health returns `200` without restarting `app`.
- `M2-D-8` The container process runs as a non-root user (`id -u` is not 0), and the image has no `.env` file or source maps for server secrets.
- `M2-D-9` Backup and restore: run `backup.sh`, destroy the volume, restore the dump into a fresh stack → the user and expense are back.
- `M2-D-10` The image builds for `linux/arm64` (build only; run under emulation is optional).

Vitest:

- `M2-U-1` Environment schema: each required variable missing → an error naming it; malformed URL → error; defaults applied.
- `M2-U-2` `SIGNUP_MODE=closed`: signup is rejected with `403` when at least one user exists and allowed when none does.
- `M2-U-3` A test that scans the source for `process.env` outside the configuration module and fails if it finds any.

Playwright (against `pnpm dev`):

- `M2-E-1` With signups closed and one existing user, the signup page shows the closed notice and the form is absent.

Documentation:

- `M2-DOC-1` Every variable in the environment schema appears in `docker/.env.example` and in the configuration table of `docs/self-hosting.md` (checked by a script).
- `M2-DOC-2` The quick start in `docs/self-hosting.md` is the exact command sequence that `M2-D-1` runs.

## Demo end state

On a machine that has only Docker: clone the repo (or download two files), copy the env example, generate two secrets, `docker compose up`. Open the browser, sign up, add an expense. Pull a newer image and restart: data intact, migrations applied. A published image exists at the registry for both architectures.

## Devlog prompt

Film and write: the clean-machine test, for real, on a spare device or fresh VM, with a timer. Show what the agent's first Dockerfile got wrong (image size, running as root, missing standalone files, monorepo context). Show the migrate-on-boot race test. Talk about what "self-hostable" has to mean for someone who is not a developer.

## Locked decisions covered

Backend (one app container and Postgres, no other service), Licence (source link offered to network users), Quality (docker build in CI).
