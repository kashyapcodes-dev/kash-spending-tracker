import { PgBoss } from "pg-boss";
import {
  authThrottle,
  syncConnection,
  type Config,
  type SyncDeps,
} from "@kash/core";
import { schema } from "@kash/db";
import { eq } from "drizzle-orm";
import { getContainer } from "./container";

/**
 * pg-boss wiring (ADR-0004). The job itself is `syncConnection` in packages/core; this file only
 * connects it to the queue. One sync per connection at a time (exclusive policy + singleton key).
 */
const QUEUE = "bank-sync";
const SWEEP = "bank-sync-all";
const EXPIRE = "agent-proposals-expire";

interface Holder {
  boss?: Promise<PgBoss>;
  working?: boolean;
}
const KEY = Symbol.for("kash.queue");
const holder = (): Holder => ((globalThis as { [KEY]?: Holder })[KEY] ??= {});

async function startBoss(config: Config): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString:
      config.DATABASE_JOBS_URL ??
      config.DATABASE_MIGRATION_URL ??
      config.DATABASE_URL,
    schema: "pgboss",
    // With a dedicated jobs role the schema is created for it (init script, docs); that role
    // has no CREATE on the database, and CREATE SCHEMA IF NOT EXISTS needs it even when present.
    createSchema: !config.DATABASE_JOBS_URL,
  });
  boss.on("error", e => console.error("[kash] queue error", e.message));
  await boss.start({ attempts: 10 });
  await boss.createQueue(QUEUE, {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
  });
  await boss.createQueue(SWEEP);
  await boss.createQueue(EXPIRE);
  return boss;
}

const getBoss = (config: Config): Promise<PgBoss> =>
  (holder().boss ??= startBoss(config));

/** Queue a sync. With WORKER_MODE=off nothing is queued (tests call the job directly). */
export async function enqueueSync(
  config: Config,
  connectionId: string,
): Promise<void> {
  if (config.WORKER_MODE === "off") return;
  const boss = await getBoss(config);
  await boss.send(QUEUE, { connectionId }, { singletonKey: connectionId });
}

/** Start the worker and the schedule in this process (inline mode, or the separate worker). */
export async function startWorker(): Promise<void> {
  const { config, db, services, syncDeps } = getContainer();
  if (holder().working) return;
  holder().working = true;
  const boss = await getBoss(config);
  // Pending agent proposals expire after seven days (M7); hourly is plenty.
  await boss.work(EXPIRE, async () => {
    await services.proposals.expireDue();
    // Sign-in failure counters idle for a day are dropped (M9).
    await authThrottle(db.db, config.AUTH_SECRET).purge();
  });
  await boss.schedule(EXPIRE, "17 * * * *");
  if (!syncDeps) return;
  await boss.work<{ connectionId: string }>(QUEUE, async ([job]) => {
    if (!job) return;
    await syncConnection(db.db, syncDeps as SyncDeps, job.data.connectionId);
  });
  await boss.work(SWEEP, async () => {
    const rows = await db.db
      .select({ id: schema.bankConnections.id })
      .from(schema.bankConnections)
      .where(eq(schema.bankConnections.status, "active"));
    for (const r of rows) await enqueueSync(config, r.id);
  });
  await boss.schedule(SWEEP, config.BANK_SYNC_CRON);
}
