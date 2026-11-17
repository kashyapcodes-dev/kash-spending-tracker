import { and, count, eq } from "drizzle-orm";
import { schema, type Database } from "@kash/db";
import type {
  Member,
  Role,
  TransferOwnershipBody,
  UpdateMemberBody,
} from "@kash/contract";
import {
  requireBudgetRole,
  roleAtLeast,
  type Actor,
  type Executor,
} from "../authz";
import { conflict, forbidden, notFound } from "../errors";
import { iso } from "./util";
import { deleteDashboardsOf } from "./dashboards";

const memberColumns = {
  userId: schema.budgetMembers.userId,
  name: schema.user.name,
  email: schema.user.email,
  role: schema.budgetMembers.role,
  joinedAt: schema.budgetMembers.createdAt,
};

async function listMembers(db: Executor, budgetId: string): Promise<Member[]> {
  const rows = await db
    .select(memberColumns)
    .from(schema.budgetMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.budgetMembers.userId))
    .where(eq(schema.budgetMembers.budgetId, budgetId))
    .orderBy(schema.budgetMembers.createdAt, schema.user.name);
  return rows.map(r => ({ ...r, joinedAt: iso(r.joinedAt) }));
}

async function loadMember(db: Executor, budgetId: string, userId: string) {
  const [row] = await db
    .select(memberColumns)
    .from(schema.budgetMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.budgetMembers.userId))
    .where(
      and(
        eq(schema.budgetMembers.budgetId, budgetId),
        eq(schema.budgetMembers.userId, userId),
      ),
    );
  if (!row) throw notFound("Member");
  return { ...row, joinedAt: iso(row.joinedAt) } satisfies Member;
}

async function ownerCount(db: Executor, budgetId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(schema.budgetMembers)
    .where(
      and(
        eq(schema.budgetMembers.budgetId, budgetId),
        eq(schema.budgetMembers.role, "owner"),
      ),
    );
  return r?.n ?? 0;
}

/** Serialise role changes on one budget so two requests cannot each leave "another" owner. */
async function lockBudget(tx: Executor, budgetId: string) {
  await tx
    .select({ id: schema.budgets.id })
    .from(schema.budgets)
    .where(eq(schema.budgets.id, budgetId))
    .for("update");
}

const setRole = (db: Executor, budgetId: string, userId: string, role: Role) =>
  db
    .update(schema.budgetMembers)
    .set({ role })
    .where(
      and(
        eq(schema.budgetMembers.budgetId, budgetId),
        eq(schema.budgetMembers.userId, userId),
      ),
    );

export function memberService(db: Database) {
  return {
    async list(actor: Actor, budgetId: string): Promise<Member[]> {
      const ctx = await requireBudgetRole(db, actor, budgetId, "viewer");
      const members = await listMembers(ctx.db, ctx.budgetId);
      if (ctx.role === "owner") return members;
      // Viewers and editors see names and roles, not other people's addresses (M9 scope 11).
      return members.map(m => {
        if (m.userId === actor.userId) return m;
        return {
          userId: m.userId,
          name: m.name,
          role: m.role,
          joinedAt: m.joinedAt,
        };
      });
    },

    async updateRole(
      actor: Actor,
      budgetId: string,
      userId: string,
      body: UpdateMemberBody,
    ): Promise<Member> {
      return db.transaction(async tx => {
        const ctx = await requireBudgetRole(tx, actor, budgetId, "owner");
        await lockBudget(tx, ctx.budgetId);
        const target = await loadMember(tx, ctx.budgetId, userId);
        if (
          target.role === "owner" &&
          body.role !== "owner" &&
          (await ownerCount(tx, ctx.budgetId)) <= 1
        )
          throw conflict("A budget needs at least one owner");
        await setRole(tx, ctx.budgetId, userId, body.role);
        return { ...target, role: body.role };
      });
    },

    /** Remove a member, or leave when `userId` is the caller. Only that membership is deleted. */
    async remove(
      actor: Actor,
      budgetId: string,
      userId: string,
    ): Promise<void> {
      await db.transaction(async tx => {
        const ctx = await requireBudgetRole(tx, actor, budgetId, "viewer");
        if (userId !== actor.userId && !roleAtLeast(ctx.role, "owner"))
          throw forbidden();
        await lockBudget(tx, ctx.budgetId);
        const target = await loadMember(tx, ctx.budgetId, userId);
        if (
          target.role === "owner" &&
          (await ownerCount(tx, ctx.budgetId)) <= 1
        )
          throw conflict("The last owner cannot leave or be removed");
        await tx
          .delete(schema.budgetMembers)
          .where(
            and(
              eq(schema.budgetMembers.budgetId, ctx.budgetId),
              eq(schema.budgetMembers.userId, userId),
            ),
          );
        // M6: a member's personal dashboards for this budget go with their membership.
        await deleteDashboardsOf(tx, ctx.budgetId, userId);
      });
    },

    /** Make the target an owner and, optionally, demote the caller to editor, in one transaction. */
    async transferOwnership(
      actor: Actor,
      budgetId: string,
      userId: string,
      body: TransferOwnershipBody,
    ): Promise<Member[]> {
      return db.transaction(async tx => {
        const ctx = await requireBudgetRole(tx, actor, budgetId, "owner");
        await lockBudget(tx, ctx.budgetId);
        await loadMember(tx, ctx.budgetId, userId);
        await setRole(tx, ctx.budgetId, userId, "owner");
        if (body.demoteSelf && userId !== actor.userId)
          await setRole(tx, ctx.budgetId, actor.userId, "editor");
        return listMembers(tx, ctx.budgetId);
      });
    },
  };
}
