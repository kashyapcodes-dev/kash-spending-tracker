import { eq } from "drizzle-orm";
import { schema, type Database } from "@kash/db";
import type { Actor } from "../authz";
import { notFound } from "../errors";
import { signOutEverywhere } from "../auth";

/** The caller's own account: sessions and verification status. Acts only on `actor.userId`. */
export function accountService(db: Database) {
  return {
    /** Delete every session of the caller and revoke every personal access token. */
    async signOutEverywhere(actor: Actor): Promise<void> {
      await signOutEverywhere(db, actor.userId);
    },
    async verification(
      actor: Actor,
    ): Promise<{ email: string; emailVerified: boolean }> {
      const [u] = await db
        .select({
          email: schema.user.email,
          emailVerified: schema.user.emailVerified,
        })
        .from(schema.user)
        .where(eq(schema.user.id, actor.userId));
      if (!u) throw notFound("User");
      return u;
    },
  };
}
