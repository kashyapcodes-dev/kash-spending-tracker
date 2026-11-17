import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@kash/db";
import { TOKEN_PREFIX } from "@kash/contract";
import type { Actor } from "../authz";
import { conflict, notFound, validationFailed } from "../errors";
import { hashToken } from "../services/invites";
import { iso } from "../services/util";

type Row = typeof schema.apiTokens.$inferSelect;
const toToken = (r: Row) => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scope: r.scope,
  budgetIds: r.budgetIds,
  lastUsedAt: r.lastUsedAt ? iso(r.lastUsedAt) : null,
  expiresAt: r.expiresAt ? iso(r.expiresAt) : null,
  createdAt: iso(r.createdAt),
});

export const TOKEN_DEFAULT_DAYS = 90;
export const TOKEN_MAX_DAYS = 366;
export const TOKEN_MAX_ACTIVE = 20;
const DAY_MS = 86_400_000;

export interface VerifiedToken {
  id: string;
  userId: string;
  scope: "read" | "read_propose";
  budgetIds: string[] | null;
}

/** Personal access tokens (M7). Only the SHA-256 is stored; the token is shown once. */
export function tokenService(db: Database) {
  const t = schema.apiTokens;
  return {
    async create(
      actor: Actor,
      body: {
        name: string;
        scope: "read" | "read_propose";
        budgetIds?: string[] | undefined;
        expiresAt?: string | null | undefined;
      },
    ) {
      const nowMs = Date.now();
      let expires: Date | null;
      if (body.expiresAt === undefined)
        expires = new Date(nowMs + TOKEN_DEFAULT_DAYS * DAY_MS);
      else if (body.expiresAt === null) expires = null;
      else {
        expires = new Date(body.expiresAt);
        if (
          expires.getTime() <= nowMs ||
          expires.getTime() > nowMs + TOKEN_MAX_DAYS * DAY_MS
        )
          throw validationFailed(
            "expiresAt must be in the future and within a year",
            [{ path: ["expiresAt"], message: "Out of range" }],
          );
      }
      const active = await db
        .select({ name: t.name, expiresAt: t.expiresAt })
        .from(t)
        .where(and(eq(t.userId, actor.userId), isNullRevoked()));
      const live = active.filter(
        r => !r.expiresAt || r.expiresAt.getTime() > nowMs,
      );
      if (live.length >= TOKEN_MAX_ACTIVE)
        throw validationFailed(
          `You can have at most ${TOKEN_MAX_ACTIVE} active tokens`,
        );
      if (live.some(r => r.name === body.name))
        throw conflict("You already have a token with that name");
      if (body.budgetIds) {
        const mine = await db
          .select({ id: schema.budgetMembers.budgetId })
          .from(schema.budgetMembers)
          .where(
            and(
              eq(schema.budgetMembers.userId, actor.userId),
              inArray(schema.budgetMembers.budgetId, body.budgetIds),
            ),
          );
        if (new Set(mine.map(m => m.id)).size !== new Set(body.budgetIds).size)
          throw validationFailed("budgetIds must be budgets you belong to", [
            { path: ["budgetIds"], message: "Unknown budget" },
          ]);
      }
      const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
      const [row] = await db
        .insert(t)
        .values({
          userId: actor.userId,
          name: body.name,
          tokenHash: hashToken(token),
          prefix: token.slice(0, 8),
          scope: body.scope,
          budgetIds: body.budgetIds ? [...new Set(body.budgetIds)] : null,
          expiresAt: expires,
        })
        .returning();
      if (!row) throw new Error("token insert returned no row");
      return { ...toToken(row), token };
    },

    async list(actor: Actor) {
      const rows = await db
        .select()
        .from(t)
        .where(and(eq(t.userId, actor.userId), isNullRevoked()))
        .orderBy(t.createdAt);
      return { items: rows.map(toToken) };
    },

    async revoke(actor: Actor, tokenId: string): Promise<void> {
      const rows = await db
        .update(t)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(t.id, tokenId), eq(t.userId, actor.userId), isNullRevoked()),
        )
        .returning({ id: t.id });
      if (rows.length === 0) throw notFound("Token");
    },

    /** Revoke every active token of the caller (sign out everywhere, password change). */
    async revokeAll(userId: string): Promise<number> {
      const rows = await db
        .update(t)
        .set({ revokedAt: new Date() })
        .where(and(eq(t.userId, userId), isNullRevoked()))
        .returning({ id: t.id });
      return rows.length;
    },

    /** The token's owner and limits, or null when unknown, revoked or expired. */
    async verify(raw: string): Promise<VerifiedToken | null> {
      if (!raw.startsWith(TOKEN_PREFIX)) return null;
      const [row] = await db
        .select()
        .from(t)
        .where(eq(t.tokenHash, hashToken(raw)));
      if (!row || row.revokedAt) return null;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
      const stale =
        !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000;
      if (stale)
        await db
          .update(t)
          .set({ lastUsedAt: new Date() })
          .where(eq(t.id, row.id));
      return {
        id: row.id,
        userId: row.userId,
        scope: row.scope,
        budgetIds: row.budgetIds,
      };
    },
  };
}

import { isNull } from "drizzle-orm";
function isNullRevoked() {
  return isNull(schema.apiTokens.revokedAt);
}
