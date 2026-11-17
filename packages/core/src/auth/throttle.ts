import { createHmac } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { schema, type Database } from "@kash/db";

export const THROTTLE_FREE_FAILURES = 5;
const BASE_LOCK_MS = 60_000;
export const MAX_LOCK_MS = 15 * 60_000;
const QUIET_RESET_MS = 15 * 60_000;

/**
 * Per-account sign-in failure counter (M9 scope 2). Keyed by an HMAC of the normalised email,
 * so unknown addresses lock exactly like known ones and the table never holds an address.
 * Five failures lock the account for a minute; each further failure doubles it, to at most
 * 15 minutes. A correct password during a lock is refused too. Quiet for 15 minutes resets.
 */
export function authThrottle(
  db: Database,
  secret: string,
  now: () => number = Date.now,
) {
  const t = schema.authThrottle;
  const keyOf = (email: string) =>
    createHmac("sha256", secret)
      .update(email.trim().toLowerCase())
      .digest("hex");

  return {
    keyOf,
    /** Seconds the account is locked for, or 0. */
    async lockedFor(email: string): Promise<number> {
      const [row] = await db
        .select({ lockedUntil: t.lockedUntil })
        .from(t)
        .where(eq(t.key, keyOf(email)));
      const left = (row?.lockedUntil?.getTime() ?? 0) - now();
      return left > 0 ? Math.ceil(left / 1000) : 0;
    },

    async recordFailure(email: string): Promise<void> {
      const key = keyOf(email);
      const at = new Date(now());
      const quiet = new Date(now() - QUIET_RESET_MS);
      // Atomic: one statement decides the new count and lock.
      await db.execute(sql`
        insert into auth_throttle (key, failures, locked_until, updated_at)
        values (${key}, 1, null, ${at})
        on conflict (key) do update set
          failures = case when auth_throttle.updated_at < ${quiet} then 1 else auth_throttle.failures + 1 end,
          updated_at = ${at},
          locked_until = case
            when (case when auth_throttle.updated_at < ${quiet} then 1 else auth_throttle.failures + 1 end) >= ${THROTTLE_FREE_FAILURES}
            then ${at}::timestamptz + least(
              ${MAX_LOCK_MS}::bigint,
              ${BASE_LOCK_MS}::bigint * power(2, least(
                (case when auth_throttle.updated_at < ${quiet} then 1 else auth_throttle.failures + 1 end) - ${THROTTLE_FREE_FAILURES}, 10))::bigint
            ) * interval '1 millisecond'
            else null end
      `);
    },

    async clear(email: string): Promise<void> {
      await db.delete(t).where(eq(t.key, keyOf(email)));
    },

    /** Rows idle for a day are removed by the hourly job. */
    async purge(): Promise<number> {
      const rows = await db
        .delete(t)
        .where(lt(t.updatedAt, new Date(now() - 86_400_000)))
        .returning({ key: t.key });
      return rows.length;
    },
  };
}
export type AuthThrottle = ReturnType<typeof authThrottle>;
