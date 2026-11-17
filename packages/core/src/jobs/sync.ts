import { and, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@kash/db";
import {
  ProviderError,
  type BankSyncProvider,
  type ProviderTransaction,
} from "@kash/integrations";
import { systemBudgetContext } from "../authz";
import { addDays } from "../dates";
import { logError } from "../errors";
import type { SecretBox } from "../crypto";
import { secretAad } from "../services/connections";
import { stageRows } from "../services/staging";

export interface SyncDeps {
  box: SecretBox;
  providers: Partial<Record<"plaid" | "simplefin", BankSyncProvider>>;
  today?: () => string;
}

/** First syncs fetch 90 days; later ones overlap the last sync by five days (dedupe makes that safe). */
export const FIRST_SYNC_DAYS = 90;
const OVERLAP_DAYS = 5;

export type SyncOutcome =
  | { status: "ok"; staged: number; updated: number }
  | { status: "skipped" }
  | { status: "needs_reauth" | "error" };

/**
 * One connection's sync (ADR-0004): a plain function over IDs. It acts as the system inside the
 * connection's own budget and writes only rows with that budget id. Errors are stored sanitised.
 */
export async function syncConnection(
  db: Database,
  deps: SyncDeps,
  connectionId: string,
): Promise<SyncOutcome> {
  const c = schema.bankConnections;
  const [conn] = await db.select().from(c).where(eq(c.id, connectionId));
  if (!conn || conn.status === "disabled") return { status: "skipped" };
  const provider = deps.providers[conn.provider];
  if (!provider) return { status: "skipped" };

  const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
  const since = conn.lastSyncedAt
    ? addDays(conn.lastSyncedAt.toISOString().slice(0, 10), -OVERLAP_DAYS)
    : addDays(today, -FIRST_SYNC_DAYS);

  let secret: string;
  try {
    secret = deps.box.decryptSecret(
      "bank-token",
      secretAad(conn.id),
      conn.secretEncrypted,
    );
  } catch {
    await db
      .update(c)
      .set({
        status: "error",
        lastError:
          "Stored credentials could not be decrypted (is APP_ENCRYPTION_KEY correct?)",
      })
      .where(eq(c.id, conn.id));
    return { status: "error" };
  }

  let result;
  try {
    result = await provider.sync(secret, conn.syncCursor, since);
  } catch (e) {
    const auth = e instanceof ProviderError && e.kind === "auth";
    // ProviderError messages are fixed strings written by the adapters (no response bodies,
    // no status text from user-supplied hosts). Anything else is logged, never stored.
    if (!(e instanceof ProviderError)) logError("bank sync failed", e);
    const message = e instanceof ProviderError ? e.message : "Sync failed";
    await db
      .update(c)
      .set({ status: auth ? "needs_reauth" : conn.status, lastError: message })
      .where(eq(c.id, conn.id));
    return { status: auth ? "needs_reauth" : "error" };
  }

  return db.transaction(async tx => {
    const ctx = await systemBudgetContext(tx, conn.budgetId);
    const accounts = await tx
      .select()
      .from(schema.bankAccounts)
      .where(
        and(
          eq(schema.bankAccounts.connectionId, conn.id),
          eq(schema.bankAccounts.budgetId, conn.budgetId),
        ),
      );
    const enabled = new Map(
      accounts.filter(x => x.enabled).map(x => [x.externalId, x.id]),
    );
    const keep = (t: ProviderTransaction) => enabled.has(t.accountExternalId);
    const label = conn.institutionName ?? conn.provider;

    const byAccount = new Map<string, ProviderTransaction[]>();
    const split = (list: ProviderTransaction[]) => {
      for (const t of list.filter(keep)) {
        const key = t.accountExternalId;
        byAccount.set(key, [...(byAccount.get(key) ?? []), t]);
      }
    };

    // Modified rows already accepted become a new staged row flagged against the accepted transaction.
    const T = schema.transactions;
    const modExt = result.modified.filter(keep).map(t => t.externalId);
    const acceptedMap = new Map<string, string>();
    if (modExt.length > 0) {
      const rows = await tx
        .select({ id: T.id, externalId: T.externalId })
        .from(T)
        .where(
          and(
            eq(T.budgetId, conn.budgetId),
            eq(T.source, conn.provider),
            inArray(T.externalId, modExt),
          ),
        );
      for (const r of rows)
        if (r.externalId) acceptedMap.set(r.externalId, r.id);
    }
    const reStage = result.modified.filter(
      t => keep(t) && acceptedMap.has(t.externalId),
    );
    split(result.added);
    split(result.modified.filter(t => !acceptedMap.has(t.externalId)));

    let staged = 0;
    let updated = 0;
    for (const [ext, items] of byAccount) {
      const r = await stageRows(ctx, {
        source: conn.provider,
        label,
        createdBy: null,
        bankAccountId: enabled.get(ext) ?? null,
        items: items.map(t => ({
          externalId: t.externalId,
          type: t.type,
          name: t.name,
          amountCents: t.amountCents,
          date: t.date,
          pendingAtBank: t.pending,
        })),
      });
      staged += r.staged;
      updated += r.updated;
    }
    if (reStage.length > 0) {
      const [batch] = await tx
        .insert(schema.importBatches)
        .values({
          budgetId: conn.budgetId,
          source: conn.provider,
          label: `${label} (changed)`,
        })
        .returning({ id: schema.importBatches.id });
      await tx.insert(schema.stagedTransactions).values(
        reStage.map(t => ({
          budgetId: conn.budgetId,
          batchId: (batch as { id: string }).id,
          bankAccountId: enabled.get(t.accountExternalId) ?? null,
          source: conn.provider,
          externalId: null,
          type: t.type,
          name: t.name,
          amountCents: t.amountCents,
          date: t.date,
          duplicateOf: acceptedMap.get(t.externalId) ?? null,
          duplicateConfidence: "likely" as const,
          pendingAtBank: t.pending,
          raw: { modifiedOf: t.externalId },
        })),
      );
      staged += reStage.length;
    }

    // Removals dismiss pending rows; accepted transactions are never touched.
    if (result.removedIds.length > 0)
      await tx
        .update(schema.stagedTransactions)
        .set({ status: "dismissed" })
        .where(
          and(
            eq(schema.stagedTransactions.budgetId, conn.budgetId),
            eq(schema.stagedTransactions.source, conn.provider),
            eq(schema.stagedTransactions.status, "pending"),
            inArray(schema.stagedTransactions.externalId, result.removedIds),
          ),
        );

    await tx
      .update(c)
      .set({
        syncCursor: result.nextCursor,
        lastSyncedAt: new Date(),
        lastError: null,
        status: "active",
      })
      .where(and(eq(c.id, conn.id), eq(c.budgetId, conn.budgetId)));
    return { status: "ok" as const, staged, updated };
  });
}
