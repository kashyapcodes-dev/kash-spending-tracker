import { sql } from "drizzle-orm";
import { type Database } from "@kash/db";
import {
  WIDGET_LABELS,
  WIDGET_TYPES,
  defaultSpecs,
  queryResultSchema,
  widgetSpecSchema,
  type QueryBatchBody,
  type QuerySlot,
} from "@kash/contract";
import { z } from "zod";
import { requireBudgetRole, type Actor, type BudgetContext } from "../authz";
import { AppError, validationFailed } from "../errors";
import { resolveRange } from "../dates";
import {
  earliestDate,
  runTargetsQuery,
  runTransactionsQuery,
} from "../widgets/query";

/** Each query batch runs with a 5 s statement timeout (set below). */

/** JSON Schema of each widget type's spec, for clients and for the AI tool in M7. */
export function widgetTypeInfo() {
  const full = z.toJSONSchema(widgetSpecSchema, {
    io: "input",
    unrepresentable: "any",
    target: "draft-2020-12",
  }) as {
    oneOf?: Record<string, unknown>[];
    anyOf?: Record<string, unknown>[];
  };
  const variants = full.oneOf ?? full.anyOf ?? [];
  return WIDGET_TYPES.map((type, i) => ({
    type,
    label: WIDGET_LABELS[type],
    schema: variants[i] ?? full,
    defaultSpec: defaultSpecs[type],
  }));
}

/** A batch may cost at most this many units (roughly: result rows it can produce). */
export const MAX_BATCH_COST = 20_000;
const PER_DAY: Record<string, number> = {
  day: 1,
  week: 1 / 7,
  month: 1 / 30,
  year: 1 / 365,
};

/** Estimated cost of one query: its time buckets, or a flat 50 for category-like groupings. */
export function estimateQueryCost(
  groupBy: string,
  from: string,
  to: string,
): number {
  const days = Math.max(
    1,
    (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1,
  );
  const per = PER_DAY[groupBy];
  return per === undefined ? 50 : Math.min(1000, Math.ceil(days * per));
}

export function widgetService(db: Database) {
  return {
    /** Run 1 to 40 queries. Identical queries run once; a failure fills only its own slot. */
    async query(
      actor: Actor,
      budgetId: string,
      body: QueryBatchBody,
    ): Promise<{ results: QuerySlot[] }> {
      return db.transaction(async tx => {
        await tx.execute(sql`set local statement_timeout = 5000`);
        const ctx: BudgetContext = await requireBudgetRole(
          tx,
          actor,
          budgetId,
          "viewer",
        );
        const today = body.today ?? new Date().toISOString().slice(0, 10);
        const earliest = await earliestDate(ctx);
        const cache = new Map<string, Promise<QuerySlot>>();

        const run = async (
          query: QueryBatchBody["queries"][number],
        ): Promise<QuerySlot> => {
          const own = query.filters.dateRange ?? {
            preset: "this_month" as const,
          };
          const effective =
            body.dateRange && !query.dateRangeLocked ? body.dateRange : own;
          const range = resolveRange(effective, today, earliest);
          try {
            return queryResultSchema.parse(
              query.source === "transactions"
                ? await runTransactionsQuery(ctx, query, range)
                : await runTargetsQuery(ctx, query, range),
            );
          } catch (e) {
            if (e instanceof AppError) return { error: { message: e.message } };
            // A timeout or other database error must not take the other slots down.
            return { error: { message: "This widget could not be loaded" } };
          }
        };

        // Refuse an oversized batch before running any of it (M9 scope 7).
        let cost = 0;
        const counted = new Set<string>();
        for (const q of body.queries) {
          const key = JSON.stringify([q, body.dateRange ?? null, today]);
          if (counted.has(key)) continue;
          counted.add(key);
          const eff =
            body.dateRange && !q.dateRangeLocked
              ? body.dateRange
              : (q.filters.dateRange ?? { preset: "this_month" as const });
          try {
            const r = resolveRange(eff, today, earliest);
            cost += estimateQueryCost(
              "groupBy" in q ? q.groupBy : "none",
              r.from,
              r.to,
            );
          } catch {
            cost += 50; // an invalid range fails in its own slot later
          }
        }
        if (cost > MAX_BATCH_COST)
          throw validationFailed(
            "This batch is too expensive. Use fewer widgets, a coarser groupBy or a shorter range.",
          );

        const results: QuerySlot[] = [];
        for (const q of body.queries) {
          // The slot map is keyed by the parsed query and the range it will actually run with.
          const key = JSON.stringify([q, body.dateRange ?? null, today]);
          let p = cache.get(key);
          if (!p) {
            p = run(q);
            cache.set(key, p);
          }
          results.push(await p);
        }
        return { results };
      });
    },

    async validate(actor: Actor, budgetId: string, spec: unknown) {
      await requireBudgetRole(db, actor, budgetId, "viewer");
      const r = widgetSpecSchema.safeParse(spec);
      return {
        valid: r.success,
        issues: r.success
          ? []
          : r.error.issues.map(i => ({
              path: i.path.filter(
                (p): p is string | number => typeof p !== "symbol",
              ),
              message: i.message,
            })),
      };
    },
  };
}
