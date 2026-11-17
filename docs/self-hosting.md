# Self-hosting Kash

Kash runs as two containers: the app and Postgres. Nothing else is required. Email, bank sync and AI are optional.

## Requirements

- Docker with the Compose plugin (Docker Desktop, or Docker Engine on Linux).
- About 512 MB of free memory and a few hundred MB of disk. Runs on `linux/amd64` and `linux/arm64` (a Raspberry Pi 4 or newer is enough).

## Quick start

```
git clone https://github.com/kashyapcodes-dev/kash-spending-tracker.git
cd kash-spending-tracker
cp docker/.env.example docker/.env
# Fill the two secrets in docker/.env, or let the helper do it (creates docker/.env itself):
#   docker/setup-env.sh
docker compose -f docker/compose.yml up -d --wait
```

Open <http://localhost:3000>, sign up, and add an expense. The first run pulls the published image. To build it from your checkout instead, add `--build`: `docker compose -f docker/compose.yml up -d --wait --build`.

(The container test `docker/test/run.sh` runs these same commands with a generated `.env`.)

## Configuration

Set variables in `docker/.env`. The app refuses to start, and names the variable, when a required one is missing or malformed.

| Variable                       | Required      | Default                 | Meaning                                                                                                           |
| ------------------------------ | ------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | yes           | set by compose          | Postgres connection string. Compose builds it from `POSTGRES_PASSWORD`; set it yourself for an external Postgres. |
| `APP_URL`                      | yes           | `http://localhost:3000` | Public base URL. Used in emailed links and for origin checks. Must match the address in the browser.              |
| `AUTH_SECRET`                  | yes           | none                    | Signs sessions and tokens. Generate with `openssl rand -base64 32`. The placeholder is refused.                   |
| `POSTGRES_PASSWORD`            | yes (compose) | none                    | Password for the bundled Postgres. Generate with `openssl rand -hex 24`.                                          |
| `AUTO_MIGRATE`                 | no            | `true`                  | Run pending database migrations on start.                                                                         |
| `SIGNUP_MODE`                  | no            | `open`                  | `open`, or `closed` (no new accounts once one exists; the first account can always be created).                   |
| `SMTP_HOST`                    | no            | unset                   | Outgoing email server, for password-reset links.                                                                  |
| `SMTP_PORT`                    | no            | `587`                   | SMTP port.                                                                                                        |
| `SMTP_USER`                    | no            | unset                   | SMTP username.                                                                                                    |
| `SMTP_PASSWORD`                | no            | unset                   | SMTP password.                                                                                                    |
| `SMTP_FROM`                    | with SMTP     | unset                   | Sender address. Required when `SMTP_HOST` is set.                                                                 |
| `APP_ENCRYPTION_KEY`           | for banks     | unset                   | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts bank tokens. Back it up separately.                  |
| `APP_ENCRYPTION_KEY_PREVIOUS`  | no            | unset                   | The old key while rotating; run `rotate-keys`, then remove it.                                                    |
| `WORKER_MODE`                  | no            | `inline`                | `inline` (web server runs the sync worker), `separate` (own process) or `off`.                                    |
| `BANK_SYNC_CRON`               | no            | `0 */6 * * *`           | Sync schedule, cron syntax.                                                                                       |
| `PLAID_CLIENT_ID`              | for Plaid     | unset                   | Your Plaid client id.                                                                                             |
| `PLAID_SECRET`                 | for Plaid     | unset                   | Your Plaid secret for `PLAID_ENV`.                                                                                |
| `PLAID_ENV`                    | no            | `sandbox`               | `sandbox`, `development` or `production`.                                                                         |
| `PLAID_WEBHOOKS`               | no            | `false`                 | Accept Plaid webhooks. Off by default; scheduled polling needs no inbound access.                                 |
| `SIMPLEFIN_ALLOWED_HOSTS`      | no            | none                    | Extra hosts (comma separated) allowed for SimpleFIN setup and access URLs, on top of `beta-bridge.simplefin.org`. |
| `TRUSTED_PROXY`                | no            | `none`                  | `none`, `loopback` or a CIDR list. Set only when all traffic arrives through that proxy; see ADR-0013.            |
| `KASH_LOG_RESET_LINKS`         | no            | `false`                 | With no SMTP, write reset links to the server log. Self-host only; a link in a log is a credential in a log.      |
| `REQUIRE_EMAIL_VERIFICATION`   | no            | `false`                 | Hold unverified accounts at a verification gate. Refused unless SMTP is configured.                               |
| `LOG_LEVEL`                    | no            | `info`                  | `debug`, `info`, `warn` or `error`.                                                                               |
| `AI_PROVIDER`                  | no            | unset                   | `anthropic`, `openai` or `ollama`. Unset disables AI. (`fake` exists for tests.)                                  |
| `AI_MODEL`                     | no            | provider default        | Model name. Defaults: see "AI agent" below.                                                                       |
| `ANTHROPIC_API_KEY`            | with provider | unset                   | Required when `AI_PROVIDER=anthropic`.                                                                            |
| `OPENAI_API_KEY`               | with provider | unset                   | Required when `AI_PROVIDER=openai`.                                                                               |
| `OLLAMA_BASE_URL`              | with provider | unset                   | Required when `AI_PROVIDER=ollama`, for example `http://host.docker.internal:11434`.                              |
| `AI_DAILY_MESSAGE_LIMIT`       | no            | unlimited               | Chat messages per user per day.                                                                                   |
| `KASH_MAIL_FILE`               | tests only    | unset                   | Append reset emails to this file. Do not set in production.                                                       |
| `KASH_DISABLE_AUTH_RATE_LIMIT` | tests only    | `false`                 | Turns off sign-in rate limiting. Do not set in production.                                                        |
| `KASH_FAKE_BANK`               | tests only    | `false`                 | Replaces Plaid and SimpleFIN with a scripted fake bank. Do not set in production.                                 |

Also read by compose only: `APP_PORT` (host port, default `3000`) and `KASH_IMAGE` (image to run).

Without SMTP, password-reset links are written to the app log (`docker compose -f docker/compose.yml logs app`), and the forgot-password page says so. To try email locally, run with `--profile mail`, set `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_FROM=kash@localhost`, and open <http://localhost:8025>.

## AI agent

Optional. Set `AI_PROVIDER` and its key (or `OLLAMA_BASE_URL`) and restart; without it the chat is hidden and the AI endpoints answer `503`. **With Anthropic or OpenAI, the budget data the model asks for (transactions, totals, category names) is sent to that provider**; the chat footer shows which provider and model are in use. Ollama keeps everything on your network.

The agent can read the budget and propose changes. It cannot write: every change is a proposal that an editor approves in the web app, and personal access tokens (Settings → Access tokens, for MCP clients) can never approve. Owners can read the agent's activity in the budget settings.

### Connecting an AI client (MCP)

Create a token in Settings → Access tokens (read only, or read and propose). Then run the MCP server where your AI client can start it:

```
KASH_URL=https://kash.example.com KASH_TOKEN=kash_... pnpm --filter @kash/mcp start
```

It speaks MCP over stdio (add it as a command in your client) or, with `KASH_MCP_TRANSPORT=http` and `KASH_MCP_PORT`, over streamable HTTP on `127.0.0.1`. Changes it proposes wait in the Proposals page for you to approve. Revoke the token to cut the client off.

## Bank sync

Bank sync needs `APP_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`). Without it CSV import still works and the connections page says bank sync is off.

- **Plaid:** create keys at the Plaid dashboard and set `PLAID_CLIENT_ID`, `PLAID_SECRET` and `PLAID_ENV` (`sandbox`, `development` or `production`). Webhooks are optional (`PLAID_WEBHOOKS=true`).
- **SimpleFIN:** no server settings. In the connections page paste the setup token from SimpleFIN Bridge.
- **Rotating the key:** set the new key as `APP_ENCRYPTION_KEY` and the old one as `APP_ENCRYPTION_KEY_PREVIOUS`, restart, run `pnpm kash rotate-keys`, then remove the old key.
- `WORKER_MODE` is `inline` (default), `separate` or `off`; `BANK_SYNC_CRON` sets the sweep schedule.

## HTTPS behind a reverse proxy

Kash does not terminate TLS. Put a reverse proxy in front. A complete example with [Caddy](https://caddyserver.com), which gets certificates by itself:

```
# Caddyfile
kash.example.com {
    reverse_proxy localhost:3000
}
```

Then set `APP_URL=https://kash.example.com` in `docker/.env` and restart the app (`docker compose -f docker/compose.yml up -d`). If `APP_URL` does not match the address you browse to, sign-in and every write request will be refused by the origin check.

Caddy passes `X-Forwarded-For` by default. Kash uses it to rate limit invite links per client address; with a proxy that does not set it, all visitors share one limit.

## Sharing a budget and installing on a phone

- **Invite someone.** Budget → Members → "Invite someone": enter their email and a role (editor can add and change data, viewer is read only). With SMTP configured Kash emails the link; without it, copy the link shown after you create the invite and send it yourself. The link works once, for that email address, for 7 days. The person signs up (or signs in) with that same address and accepts. An invite also lets that address sign up when `SIGNUP_MODE=closed`.
- **Install on a phone.** Browsers only offer to install a web app over HTTPS (or on `localhost`), so set up the reverse proxy above first. Android Chrome: menu → "Install app". iPhone Safari: Share → "Add to Home Screen".
- **Offline.** Pages you opened while signed in are readable without a connection, marked "Offline. Showing saved data", with adding and editing disabled. Signing out deletes that saved data from the device. Everything is read-only offline; nothing is queued.

## Upgrading

```
git pull
docker compose -f docker/compose.yml pull     # or add --build to build from source
docker compose -f docker/compose.yml up -d --wait
```

Pending migrations run on start, under a database lock so two instances cannot race. Back up first (below). To run migrations by hand, set `AUTO_MIGRATE=false` and run `docker compose -f docker/compose.yml run --rm app node ./migrate.mjs ./drizzle`.

## Backup and restore

Back up with the script, which writes a timestamped dump and keeps the newest 14:

```
docker/backup.sh ./backups        # run from the repo root
```

This is `pg_dump --format=custom` of the `kash` database. Run it from cron for regular backups. Copy the dumps off the machine yourself; Kash does not do off-site backups.

Restore into a fresh stack:

```
docker compose -f docker/compose.yml up -d db --wait
docker compose -f docker/compose.yml exec -T db createdb -U kash restore
docker compose -f docker/compose.yml exec -T db pg_restore -U kash -d restore --no-owner < backups/kash-YYYYMMDDTHHMMSSZ.dump
```

To make the restored database the live one, restore into `kash` itself on an empty volume: `docker compose -f docker/compose.yml down -v`, `up -d db --wait`, then `pg_restore -U kash -d kash --no-owner --clean --if-exists` as above, then `up -d --wait`.

Back up `docker/.env` separately. Losing `AUTH_SECRET` signs everyone out. From the bank-sync milestone on, `APP_ENCRYPTION_KEY` must also be backed up separately: without it, stored bank tokens cannot be decrypted, and the database dump alone does not contain it.

## Troubleshooting

- **The `app` container exits immediately.** Read `docker compose -f docker/compose.yml logs app`. A configuration error lists each bad variable, for example `AUTH_SECRET: is still the placeholder value`.
- **"Cross-site request refused" or sign-in does nothing.** `APP_URL` does not match the address in your browser (scheme, host and port).
- **An invite email never arrives.** SMTP is not configured or the send failed. The page that creates the invite says so; copy the link from there.
- **"Too many requests" on invite links.** Limits are per client address; check that your reverse proxy sets `X-Forwarded-For`.
- **A phone keeps showing the old version.** The app shows "Update available" with a Reload button when a new version is ready; otherwise close and reopen it.
- **A forgot-password email never arrives.** SMTP is not configured, so reset links are not available. Ask the instance administrator, or (self-host only) set `KASH_LOG_RESET_LINKS=true` to write links to the server log.
- **Health check.** `curl http://localhost:3000/api/v1/health` returns `{"status":"ok","db":"ok","version":"..."}`, or `503` when the database is unreachable. The app recovers by itself when the database comes back.
- **Start over (deletes all data).** `docker compose -f docker/compose.yml down -v`.

## Source code

Kash is AGPL-3.0. The app footer links to the source of the running version, as the licence requires for a network service. If you modify Kash and let others use your instance, you must offer them your modified source.

## Database roles and security settings (M9)

A new install creates three database roles on first start (`docker/initdb/01-roles.sh`): `kash_migrator` (owns the schema and runs migrations), `kash_app` (the running app: row reads and writes only, no DDL, not a superuser) and `kash_jobs` (pg-boss, its own schema). `docker/setup-env.sh` generates a password for each.

**Upgrading an existing install** keeps working: with `DATABASE_MIGRATION_URL` unset the app migrates as `DATABASE_URL` and logs a warning. To adopt the roles, run once as the Postgres admin (replace the passwords) and then set `DATABASE_URL`, `DATABASE_MIGRATION_URL` and `DATABASE_JOBS_URL` to the new roles:

```sql
CREATE ROLE kash_migrator LOGIN PASSWORD '...' NOSUPERUSER;
CREATE ROLE kash_app LOGIN PASSWORD '...' NOSUPERUSER;
CREATE ROLE kash_jobs LOGIN PASSWORD '...' NOSUPERUSER;
ALTER SCHEMA public OWNER TO kash_migrator;
REASSIGN OWNED BY kash TO kash_migrator;      -- tables, sequences and types
GRANT CONNECT, CREATE ON DATABASE kash TO kash_migrator;
GRANT CONNECT, TEMPORARY ON DATABASE kash TO kash_app, kash_jobs;
CREATE SCHEMA pgboss AUTHORIZATION kash_jobs;
```

Restart the app: migration `0005` grants `kash_app` its table rights. Managed databases that will not let the migration create or alter roles can run the grants from the end of `packages/db/drizzle/0005_security_hardening.sql` by hand.

**Reverse proxy.** Set `TRUSTED_PROXY` to `loopback` or the proxy's address range only when every request reaches Kash through that proxy; the right-most `X-Forwarded-For` entry outside the range is then the client. With the default `none`, forwarding headers are ignored and rate limits share one bucket per instance.

**Email verification.** `REQUIRE_EMAIL_VERIFICATION=true` needs SMTP. Unverified accounts see a verification page and every API call except `me`, resend and sign-out returns `403 email_unverified`.

**Backups** are written with mode `600` in a `700` directory. They contain every budget in clear; encrypt them before copying them off the host (for example `age -p -o backup.age backup.dump`).

**SimpleFIN.** Setup tokens must point at `beta-bridge.simplefin.org`. Add other hosts with `SIMPLEFIN_ALLOWED_HOSTS` (comma separated).
