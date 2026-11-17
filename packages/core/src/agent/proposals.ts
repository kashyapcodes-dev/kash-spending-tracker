/**
 * Agent proposals (M7). A proposal is a stored, validated list of operations with a preview the
 * server computed. Nothing is applied until a person approves, and then every operation runs
 * through the normal services as the approver, in one database transaction.
 */
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@kash/db";
import {
  MAX_PROPOSAL_OPERATIONS,
  proposalOperationsSchema,
  type CategoryRef,
  type Proposal,
  type ProposalOperation,
  type ProposalPreview,
} from "@kash/contract";
import { requireBudgetRole, type Actor, type BudgetContext } from "../authz";
import {
  conflict,
  logError,
  notFound,
  safeCode,
  validationFailed,
} from "../errors";
import { createServices } from "../services";
import { iso } from "../services/util";
import { decodeAuditCursor, encodeAuditCursor, writeAudit } from "./audit";

export const PROPOSAL_TTL_MS = 7 * 24 * 3600 * 1000;
type Origin = "chat" | "mcp";
type Row = typeof schema.agentProposals.$inferSelect;
type Rec = Record<string, unknown>;

const p = schema.agentProposals;
const T = schema.transactions;
const C = schema.categories;
const S = schema.stagedTransactions;
const G = schema.categoryTargets;

const toProposal = (r: Row): Proposal => ({
  id: r.id,
  budgetId: r.budgetId,
  userId: r.userId,
  conversationId: r.conversationId,
  origin: r.origin,
  summary: r.summary,
  operations: r.operations as ProposalOperation[],
  preview: r.preview as ProposalPreview,
  status: r.status,
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
  result: r.result ?? null,
  expiresAt: iso(r.expiresAt),
  createdAt: iso(r.createdAt),
});

const isRef = (v: unknown): v is CategoryRef =>
  typeof v === "object" && v !== null && "$ref" in v;
const bad = (index: number, message: string) =>
  validationFailed("Invalid proposal", [
    { path: ["operations", index], message },
  ]);

const txRec = (r: typeof T.$inferSelect): Rec => ({
  type: r.type,
  name: r.name,
  amountCents: r.amountCents,
  date: r.date,
  categoryId: r.categoryId,
  notes: r.notes,
});

/** The fields an operation's target had when the proposal was made. Approval compares them again. */
async function snapshot(
  ctx: BudgetContext,
  op: ProposalOperation,
): Promise<Rec | null> {
  const db = ctx.db;
  switch (op.op) {
    case "transaction.update":
    case "transaction.delete": {
      const [r] = await db
        .select()
        .from(T)
        .where(and(eq(T.id, op.id), eq(T.budgetId, ctx.budgetId)));
      return r ? txRec(r) : null;
    }
    case "category.update": {
      const [r] = await db
        .select()
        .from(C)
        .where(and(eq(C.id, op.id), eq(C.budgetId, ctx.budgetId)));
      return r ? { name: r.name, isActive: r.isActive } : null;
    }
    case "category_target.set": {
      if (isRef(op.categoryId)) return { amountCents: null };
      const [r] = await db
        .select()
        .from(G)
        .where(
          and(eq(G.budgetId, ctx.budgetId), eq(G.categoryId, op.categoryId)),
        );
      return { amountCents: r?.amountCents ?? null };
    }
    default:
      return null;
  }
}

/** Every referenced ID must exist in this budget; `$ref`s must point at an earlier category.create. */
async function validateRefs(
  ctx: BudgetContext,
  ops: readonly ProposalOperation[],
): Promise<void> {
  const txIds = new Set<string>();
  const catIds = new Set<string>();
  const stagedIds = new Set<string>();
  ops.forEach((op, i) => {
    const cat = (v: unknown) => {
      if (isRef(v)) {
        const target = ops[v.$ref];
        if (v.$ref >= i || target?.op !== "category.create")
          throw bad(i, "$ref must point to an earlier category.create");
      } else if (typeof v === "string") catIds.add(v);
    };
    switch (op.op) {
      case "transaction.create":
        cat(op.data.categoryId);
        break;
      case "transaction.update":
        txIds.add(op.id);
        cat(op.data.categoryId);
        break;
      case "transaction.delete":
        txIds.add(op.id);
        break;
      case "category.update":
        catIds.add(op.id);
        break;
      case "category_target.set":
        cat(op.categoryId);
        break;
      case "staged.accept":
        op.items.forEach(it => {
          stagedIds.add(it.id);
          cat(it.categoryId);
        });
        break;
      case "staged.dismiss":
        op.ids.forEach(id => stagedIds.add(id));
        break;
      default:
        break;
    }
  });
  const count = async (
    table: typeof T | typeof C | typeof S,
    ids: Set<string>,
  ) => {
    if (ids.size === 0) return 0;
    const rows = await ctx.db
      .select({ id: table.id })
      .from(table)
      .where(
        and(eq(table.budgetId, ctx.budgetId), inArray(table.id, [...ids])),
      );
    return rows.length;
  };
  const [t, c, s] = await Promise.all([
    count(T, txIds),
    count(C, catIds),
    count(S, stagedIds),
  ]);
  if (t !== txIds.size || c !== catIds.size || s !== stagedIds.size)
    throw validationFailed(
      "The proposal refers to something that is not in this budget",
      [
        {
          path: ["operations"],
          message: "Unknown transaction, category or staged row",
        },
      ],
    );
}

async function buildPreview(
  ctx: BudgetContext,
  ops: readonly ProposalOperation[],
): Promise<{ preview: ProposalPreview; before: (Rec | null)[] }> {
  const items: ProposalPreview["items"] = [];
  const befores: (Rec | null)[] = [];
  const totals = {
    created: 0,
    updated: 0,
    deleted: 0,
    expenseDeltaCents: 0,
    incomeDeltaCents: 0,
  };
  const delta = (type: string, cents: number) => {
    if (type === "expense") totals.expenseDeltaCents += cents;
    else totals.incomeDeltaCents += cents;
  };
  for (const [index, op] of ops.entries()) {
    const before = await snapshot(ctx, op);
    befores.push(before);
    const push = (
      kind: "create" | "update" | "delete",
      label: string,
      b: Rec | null,
      a: Rec | null,
    ) => items.push({ index, op: op.op, kind, label, before: b, after: a });
    switch (op.op) {
      case "transaction.create":
        totals.created++;
        delta(op.data.type, op.data.amountCents);
        push("create", op.data.name, null, { ...op.data });
        break;
      case "transaction.update": {
        const b = before as Rec;
        const a = { ...b, ...op.data } as Rec;
        totals.updated++;
        delta(String(b.type), -Number(b.amountCents));
        delta(String(a.type), Number(a.amountCents));
        push("update", String(a.name), b, a);
        break;
      }
      case "transaction.delete": {
        const b = before as Rec;
        totals.deleted++;
        delta(String(b.type), -Number(b.amountCents));
        push("delete", String(b.name), b, null);
        break;
      }
      case "category.create":
        totals.created++;
        push("create", op.data.name, null, { ...op.data });
        break;
      case "category.update": {
        const b = before as Rec;
        totals.updated++;
        push("update", String(b.name), b, { ...b, ...op.data });
        break;
      }
      case "category_target.set":
        totals.updated++;
        push("update", "Monthly target", before, {
          amountCents: op.amountCents,
        });
        break;
      case "staged.accept": {
        const rows = await ctx.db
          .select()
          .from(S)
          .where(
            and(
              eq(S.budgetId, ctx.budgetId),
              inArray(
                S.id,
                op.items.map(i => i.id),
              ),
            ),
          );
        for (const r of rows) {
          totals.created++;
          delta(r.type, r.amountCents);
          push("create", r.name, null, {
            type: r.type,
            name: r.name,
            amountCents: r.amountCents,
            date: r.date,
          });
        }
        break;
      }
      case "staged.dismiss": {
        const rows = await ctx.db
          .select()
          .from(S)
          .where(and(eq(S.budgetId, ctx.budgetId), inArray(S.id, op.ids)));
        for (const r of rows) {
          totals.deleted++;
          push(
            "delete",
            r.name,
            { name: r.name, amountCents: r.amountCents },
            null,
          );
        }
        break;
      }
    }
  }
  return { preview: { items, totals }, before: befores };
}

/** Key order is not stable through jsonb, so compare with sorted keys. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Rec).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

export function proposalService(db: Database) {
  const load = async (ctx: BudgetContext, id: string): Promise<Row> => {
    const [row] = await ctx.db
      .select()
      .from(p)
      .where(and(eq(p.id, id), eq(p.budgetId, ctx.budgetId)));
    if (!row) throw notFound("Proposal");
    return row;
  };

  async function markFailed(
    ctx: BudgetContext,
    row: Row,
    reason: string,
    code: string,
  ) {
    await db
      .update(p)
      .set({
        status: "failed",
        decidedBy: ctx.actor.userId,
        decidedAt: new Date(),
        result: { reason },
      })
      .where(and(eq(p.id, row.id), eq(p.status, "pending")));
    await writeAudit(db, {
      budgetId: ctx.budgetId,
      userId: ctx.actor.userId,
      origin: row.origin,
      conversationId: row.conversationId,
      event: "proposal_failed",
      outcome: "error",
      detail: { proposalId: row.id, code },
    });
  }

  return {
    /** Validate, preview and store a pending proposal. Changes no budget data. */
    async create(
      actor: Actor,
      budgetId: string,
      input: {
        summary: string;
        operations: unknown;
        origin: Origin;
        conversationId?: string | null;
      },
    ): Promise<Proposal> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "editor");
      if (
        Array.isArray(input.operations) &&
        input.operations.length > MAX_PROPOSAL_OPERATIONS
      )
        throw validationFailed(
          `At most ${MAX_PROPOSAL_OPERATIONS} operations per proposal`,
        );
      const parsed = proposalOperationsSchema.safeParse(input.operations);
      if (!parsed.success)
        throw validationFailed("Invalid operations", parsed.error.issues);
      const ops = parsed.data;
      await validateRefs(ctx, ops);
      const { preview } = await buildPreview(ctx, ops);
      const [row] = await ctx.db
        .insert(p)
        .values({
          budgetId: ctx.budgetId,
          userId: actor.userId,
          conversationId: input.conversationId ?? null,
          origin: input.origin,
          summary: input.summary.slice(0, 300),
          operations: ops,
          preview,
          expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        })
        .returning();
      if (!row) throw new Error("proposal insert returned no row");
      await writeAudit(ctx.db, {
        budgetId: ctx.budgetId,
        userId: actor.userId,
        origin: input.origin,
        conversationId: input.conversationId ?? null,
        event: "proposal_created",
        outcome: "ok",
        detail: { proposalId: row.id, operations: ops.length },
      });
      return toProposal(row);
    },

    async get(actor: Actor, budgetId: string, id: string): Promise<Proposal> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "viewer");
      return toProposal(await load(ctx, id));
    },

    async list(
      actor: Actor,
      budgetId: string,
      q: {
        limit: number;
        cursor?: string | undefined;
        status?: Row["status"] | undefined;
      },
    ) {
      const ctx = await requireBudgetRole(db, actor, budgetId, "viewer");
      const cur = q.cursor ? decodeAuditCursor(q.cursor) : undefined;
      const rows = await ctx.db
        .select()
        .from(p)
        .where(
          and(
            eq(p.budgetId, ctx.budgetId),
            q.status ? eq(p.status, q.status) : undefined,
            cur
              ? or(
                  lt(p.createdAt, cur.at),
                  and(eq(p.createdAt, cur.at), lt(p.id, cur.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(p.createdAt), desc(p.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toProposal),
        nextCursor:
          rows.length > q.limit && last
            ? encodeAuditCursor(last.createdAt, last.id)
            : null,
      };
    },

    /**
     * Apply a proposal (or a subset) as `actor`, all or nothing. If anything a pending operation
     * targeted has changed since the preview, nothing is applied: 409 and the proposal is `failed`.
     */
    async approve(
      actor: Actor,
      budgetId: string,
      id: string,
      opts: { operationIndexes?: number[] | undefined } = {},
    ): Promise<Proposal> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "editor");
      const row = await load(ctx, id);
      if (row.status === "pending" && row.expiresAt.getTime() <= Date.now()) {
        await db
          .update(p)
          .set({ status: "expired" })
          .where(and(eq(p.id, row.id), eq(p.status, "pending")));
        throw conflict("This proposal has expired");
      }
      if (row.status !== "pending")
        throw conflict(`This proposal is already ${row.status}`);

      const ops = row.operations as ProposalOperation[];
      const preview = row.preview as ProposalPreview;
      const chosen = [
        ...new Set(opts.operationIndexes ?? ops.map((_, i) => i)),
      ].sort((a, b) => a - b);
      if (chosen.some(i => i < 0 || i >= ops.length))
        throw validationFailed("Unknown operation index");
      // A chosen operation may not depend on a category.create that was unticked.
      for (const i of chosen) {
        const refs = JSON.stringify(ops[i]).matchAll(/"\$ref":(\d+)/g);
        for (const m of refs)
          if (!chosen.includes(Number(m[1])))
            throw validationFailed(
              `Operation ${i} needs operation ${m[1]}, which is not selected`,
            );
      }

      const result: {
        appliedIndexes: number[];
        transactionIds: string[];
        categoryIds: string[];
      } = {
        appliedIndexes: chosen,
        transactionIds: [],
        categoryIds: [],
      };
      try {
        await db.transaction(async tx => {
          // Lock the proposal so two approvals cannot both apply.
          const [locked] = await tx
            .select({ status: p.status })
            .from(p)
            .where(eq(p.id, row.id))
            .for("update");
          if (locked?.status !== "pending")
            throw conflict("This proposal was already decided");
          const txCtx = await requireBudgetRole(tx, actor, budgetId, "editor");
          // Stale check against the preview's "before" values.
          for (const i of chosen) {
            const op = ops[i] as ProposalOperation;
            if (
              op.op === "transaction.update" ||
              op.op === "transaction.delete" ||
              op.op === "category.update" ||
              op.op === "category_target.set"
            ) {
              const was = preview.items.find(it => it.index === i)?.before;
              const now = await snapshot(txCtx, op);
              if (now === null || !same(was, now))
                throw conflict(
                  "The data changed since this proposal was made. Ask for a new one.",
                );
            }
          }
          const svc = createServices(tx as unknown as Database);
          const refs = new Map<number, string>();
          const cat = (v: string | CategoryRef | null | undefined) =>
            isRef(v) ? (refs.get(v.$ref) ?? null) : v;
          for (const i of chosen) {
            const op = ops[i] as ProposalOperation;
            switch (op.op) {
              case "category.create": {
                const c = await svc.categories.create(actor, budgetId, op.data);
                refs.set(i, c.id);
                result.categoryIds.push(c.id);
                break;
              }
              case "category.update":
                await svc.categories.update(actor, budgetId, op.id, op.data);
                break;
              case "category_target.set": {
                const cid = cat(op.categoryId);
                if (!cid) throw conflict("Target category missing");
                await svc.targets.set(actor, budgetId, cid, op.amountCents);
                break;
              }
              case "transaction.create": {
                const [t] = await svc.transactions.createMany(actor, budgetId, [
                  { ...op.data, categoryId: cat(op.data.categoryId) },
                ]);
                if (t) result.transactionIds.push(t.id);
                break;
              }
              case "transaction.update": {
                const { categoryId, ...rest } = op.data;
                await svc.transactions.update(actor, budgetId, op.id, {
                  ...rest,
                  ...(categoryId !== undefined && {
                    categoryId: cat(categoryId),
                  }),
                });
                result.transactionIds.push(op.id);
                break;
              }
              case "transaction.delete":
                await svc.transactions.remove(actor, budgetId, op.id);
                break;
              case "staged.accept": {
                const r = await svc.staging.accept(
                  actor,
                  budgetId,
                  op.items.map(it => ({
                    id: it.id,
                    ...(it.categoryId !== undefined && {
                      categoryId: cat(it.categoryId),
                    }),
                  })),
                );
                result.transactionIds.push(...r.transactionIds);
                break;
              }
              case "staged.dismiss":
                await svc.staging.dismiss(actor, budgetId, op.ids);
                break;
            }
          }
          await tx
            .update(p)
            .set({
              status: "approved",
              decidedBy: actor.userId,
              decidedAt: new Date(),
              result,
            })
            .where(eq(p.id, row.id));
          await writeAudit(tx, {
            budgetId,
            userId: actor.userId,
            origin: row.origin,
            conversationId: row.conversationId,
            event: "proposal_approved",
            outcome: "ok",
            detail: { proposalId: row.id, applied: chosen.length },
          });
        });
      } catch (e) {
        const raw = e instanceof Error ? e.message : "";
        // A concurrent decision is not this proposal failing.
        if (!/already decided/.test(raw)) {
          // Stored and shown: a fixed message and a short code, never the raw error.
          logError("proposal approval failed", e);
          await markFailed(
            ctx,
            row,
            "The change could not be applied. Nothing was changed.",
            safeCode(e),
          );
        }
        throw e;
      }
      return toProposal(await load(ctx, id));
    },

    async reject(
      actor: Actor,
      budgetId: string,
      id: string,
    ): Promise<Proposal> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "editor");
      const row = await load(ctx, id);
      if (row.status !== "pending")
        throw conflict(`This proposal is already ${row.status}`);
      const done = await db
        .update(p)
        .set({
          status: "rejected",
          decidedBy: actor.userId,
          decidedAt: new Date(),
        })
        .where(and(eq(p.id, id), eq(p.status, "pending")))
        .returning();
      if (done.length === 0)
        throw conflict("This proposal was already decided");
      await writeAudit(db, {
        budgetId,
        userId: actor.userId,
        origin: row.origin,
        conversationId: row.conversationId,
        event: "proposal_rejected",
        outcome: "ok",
        detail: { proposalId: id },
      });
      return toProposal(await load(ctx, id));
    },

    /** Mark pending proposals past their expiry as expired (run by a scheduled job). */
    async expireDue(now = new Date()): Promise<number> {
      const rows = await db
        .update(p)
        .set({ status: "expired" })
        .where(and(eq(p.status, "pending"), sql`${p.expiresAt} <= ${now}`))
        .returning();
      for (const r of rows)
        await writeAudit(db, {
          budgetId: r.budgetId,
          userId: r.userId,
          origin: r.origin,
          conversationId: r.conversationId,
          event: "proposal_expired",
          outcome: "ok",
          detail: { proposalId: r.id },
        });
      return rows.length;
    },
  };
}
