# ADR-0004: Background jobs with pg-boss

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone:** M5 (first use), M2 (deployment shape)

## Context

Bank sync (M5) needs scheduled and retried work: poll each connection, fetch transactions, stage them. Later milestones add more (invite and reset emails that should retry, expiry of AI proposals, usage roll-ups in hosted mode).

The self-host target is `docker compose up` with one app container and one Postgres container. Requiring Redis or a separate queue service would break that. A hosted deployment, on the other hand, may run several web instances and should not run every job on every one.

## Decision

Use **pg-boss**, a job queue that stores jobs in Postgres, with the queue in its own schema in the application database.

- **Where workers run.** Controlled by `WORKER_MODE`:
  - `inline` (default, self-host): the web server starts the worker in-process when it boots, from the Next.js instrumentation hook, on the Node runtime only.
  - `separate`: the web server only enqueues. A worker entry point from the same image (`node apps/web/worker.js`, exact path set in M5) runs as its own process or compose service.
  - `off`: no worker. Jobs are enqueued and wait. Used in tests and one-off CLI runs.
- **Job code lives in `packages/core`** as plain functions `(payload, deps) => Promise<void>`. The queue wiring is a thin layer, so jobs are unit-testable without a queue.
- **Scheduling** uses pg-boss schedules (cron expressions) registered at worker start. Bank sync defaults to every six hours and is configurable with `BANK_SYNC_CRON`.
- **Retries** use the queue's retry with backoff. Jobs are idempotent: a sync job that runs twice stages nothing twice, because staging de-duplicates on `(provider, external_id)`.
- **Concurrency.** One sync job per bank connection at a time, using the queue's singleton key.
- **Authorization.** A job payload carries IDs only. The job re-loads the records and acts as the system actor within one budget; it never takes a user's session.
- **Schema.** pg-boss creates and migrates its own schema. The application's Drizzle migrations do not manage it. Backups include it, and losing it loses only pending jobs.

pg-boss's API has changed between major versions. Check its current documentation when implementing; this ADR fixes the choice and the deployment shape, not method names.

## Alternatives considered

- **BullMQ.** Mature, but needs Redis, which adds a container for self-hosters.
- **Graphile Worker.** Also Postgres-backed and a good fit. pg-boss was preferred for built-in cron scheduling and singleton jobs without extra tables to define. Either would work; this is the closest call in the ADR.
- **A cron container hitting an HTTP endpoint.** Simple, but no retries, no per-connection concurrency control, and an endpoint that must be protected.
- **`setInterval` in the web process.** No persistence, runs on every instance, loses work on restart.
- **A hosted queue or serverless cron.** Violates "self-host needs no third-party service".

## Consequences

- No new infrastructure for self-hosters. Postgres is the only stateful service.
- The standalone Next.js server must be a long-running Node process (it is, in Docker). Kash does not target serverless hosting, where an in-process worker cannot run.
- Queue load shares the database. At personal scale that is negligible; hosted mode can point the queue at a separate database later.
- Tests run with `WORKER_MODE=off` and call job functions directly.
