import { and, count, eq } from "drizzle-orm";
import { schema, type Database } from "@kash/db";
import type {
  Budget,
  CreateBudgetBody,
  Me,
  UpdateBudgetBody,
} from "@kash/contract";
import { requireBudgetRole, type Actor, type Executor } from "../authz";
import { conflict, notFound } from "../errors";
import { iso } from "./util";

type BudgetRow = typeof schema.budgets.$inferSelect;
const toBudget = (b: BudgetRow, role: Budget["role"]): Budget => ({
  id: b.id,
  name: b.name,
  currency: b.currency,
  role,
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
});

/** Create a budget and its owner membership. Used by `createBudget` and by signup. */
export async function insertBudgetWithOwner(
  db: Database,
  userId: string,
  input: { name: string; currency?: string | undefined },
): Promise<Budget> {
  return db.transaction(async tx => {
    const [budget] = await tx
      .insert(schema.budgets)
      .values({
        name: input.name,
        currency: input.currency ?? "USD",
        createdBy: userId,
      })
      .returning();
    if (!budget) throw new Error("budget insert returned no row");
    await tx
      .insert(schema.budgetMembers)
      .values({ budgetId: budget.id, userId, role: "owner" });
    return toBudget(budget, "owner");
  });
}

export function budgetService(db: Database) {
  const listFor = async (
    executor: Executor,
    userId: string,
  ): Promise<Budget[]> => {
    const rows = await executor
      .select({ budget: schema.budgets, role: schema.budgetMembers.role })
      .from(schema.budgetMembers)
      .innerJoin(
        schema.budgets,
        eq(schema.budgets.id, schema.budgetMembers.budgetId),
      )
      .where(eq(schema.budgetMembers.userId, userId))
      .orderBy(schema.budgets.createdAt);
    return rows.map(r => toBudget(r.budget, r.role));
  };

  return {
    /** Scoped to the caller's memberships. */
    async list(actor: Actor): Promise<Budget[]> {
      return listFor(db, actor.userId);
    },

    async me(actor: Actor): Promise<Me> {
      const [u] = await db
        .select({
          id: schema.user.id,
          email: schema.user.email,
          name: schema.user.name,
          emailVerified: schema.user.emailVerified,
        })
        .from(schema.user)
        .where(eq(schema.user.id, actor.userId));
      if (!u) throw notFound("User");
      let budgets = await listFor(db, actor.userId);
      if (budgets.length === 0) {
        // Self-heal a user whose signup hook did not complete (see ADR-0007).
        budgets = [
          await insertBudgetWithOwner(db, actor.userId, { name: "My Budget" }),
        ];
      }
      return { user: u, budgets };
    },

    async create(actor: Actor, body: CreateBudgetBody): Promise<Budget> {
      return insertBudgetWithOwner(db, actor.userId, body);
    },

    async get(actor: Actor, budgetId: string): Promise<Budget> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "viewer");
      return toBudget(ctx.budget, ctx.role);
    },

    async update(
      actor: Actor,
      budgetId: string,
      body: UpdateBudgetBody,
    ): Promise<Budget> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "owner");
      const [row] = await ctx.db
        .update(schema.budgets)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.currency !== undefined && { currency: body.currency }),
        })
        .where(eq(schema.budgets.id, ctx.budgetId))
        .returning();
      if (!row) throw notFound("Budget");
      return toBudget(row, ctx.role);
    },

    /** Deletes the budget and, by cascade, its members, categories, transactions and presets. */
    async remove(actor: Actor, budgetId: string): Promise<void> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "owner");
      const [n] = await ctx.db
        .select({ n: count() })
        .from(schema.budgetMembers)
        .where(and(eq(schema.budgetMembers.userId, actor.userId)));
      if ((n?.n ?? 0) <= 1)
        throw conflict("You cannot delete your only budget");
      await ctx.db
        .delete(schema.budgets)
        .where(eq(schema.budgets.id, ctx.budgetId));
    },
  };
}
