/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely typed JSON */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authThrottle, createAuth } from "@kash/core";
import { schema } from "@kash/db";
import { call, container, createUser, db } from "./helpers";

const SECRET = "auth-m9-secret-auth-m9-secret-auth-m9-1";
const sent: { email: string; url: string }[] = [];
const auth = createAuth({
  db: db(),
  secret: SECRET,
  baseURL: "http://localhost:3000",
  disableRateLimit: true,
  sendResetPassword: m => void sent.push(m),
});

async function signUp(label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = "correct horse battery";
  const r = await auth.api.signUpEmail({
    body: { name: label, email, password },
    returnHeaders: true,
  });
  const cookie = r.headers
    .getSetCookie()
    .map(c => c.split(";")[0])
    .join("; ");
  return { id: r.response.user.id, email, password, cookie };
}
const sessionOf = (cookie: string) =>
  auth.api.getSession({ headers: new Headers({ cookie }) });
const wrong = (email: string) =>
  auth.api
    .signInEmail({ body: { email, password: "wrong password!" } })
    .then(() => "ok")
    .catch((e: any) => e.body?.code ?? e.message);

describe("M9-U-6 sign-in lockout", () => {
  it("5 failures lock the email, even for the right password; others are unaffected", async () => {
    const u = await signUp("lock");
    const other = await signUp("free");
    for (let i = 0; i < 5; i++) await wrong(u.email);
    const locked = await auth.api
      .signInEmail({ body: { email: u.email, password: u.password } })
      .catch((e: any) => e);
    expect(locked.statusCode ?? locked.status).toBeDefined();
    expect(String(locked.body?.message)).toMatch(/Too many attempts/);
    expect(
      locked.headers?.get?.("retry-after") ?? locked.headers?.["retry-after"],
    ).toBeTruthy();
    const ok = await auth.api.signInEmail({
      body: { email: other.email, password: other.password },
    });
    expect(ok.user.id).toBe(other.id);
  });

  it("an unknown email locks identically and stores only a hash", async () => {
    const email = `ghost-${randomUUID()}@example.test`;
    for (let i = 0; i < 5; i++) await wrong(email);
    const e = await wrong(email);
    expect(e).toBe("TOO_MANY_ATTEMPTS");
    const keys = (await db().select().from(schema.authThrottle)).map(
      r => r.key,
    );
    expect(keys.some(k => k.includes("ghost"))).toBe(false);
    expect(keys.every(k => /^[0-9a-f]{64}$/.test(k))).toBe(true);
  });

  it("the lock grows, is capped at 15 minutes, and decays", async () => {
    let t = Date.now();
    const th = authThrottle(db(), SECRET, () => t);
    const email = `decay-${randomUUID()}@example.test`;
    for (let i = 0; i < 4; i++) await th.recordFailure(email);
    expect(await th.lockedFor(email)).toBe(0);
    await th.recordFailure(email);
    expect(await th.lockedFor(email)).toBeGreaterThan(55);
    expect(await th.lockedFor(email)).toBeLessThanOrEqual(60);
    for (let i = 0; i < 12; i++) {
      t += 16 * 60_000; // wait out each lock but stay within the failure memory
      t -= 15 * 60_000 + 1;
      await th.recordFailure(email);
    }
    expect(await th.lockedFor(email)).toBeLessThanOrEqual(15 * 60);
    t += 16 * 60_000;
    expect(await th.lockedFor(email)).toBe(0); // decayed
    await th.recordFailure(email); // counter restarted after quiet time
    expect(await th.lockedFor(email)).toBe(0);
  });

  it("a success clears the counter", async () => {
    const u = await signUp("clear");
    for (let i = 0; i < 4; i++) await wrong(u.email);
    await auth.api.signInEmail({
      body: { email: u.email, password: u.password },
    });
    for (let i = 0; i < 4; i++) await wrong(u.email);
    const ok = await auth.api.signInEmail({
      body: { email: u.email, password: u.password },
    });
    expect(ok.user.id).toBe(u.id);
  });
});

describe("M9-U-8 password reset and change", () => {
  it("a reset revokes other sessions and all tokens; the link works once", async () => {
    const u = await signUp("reset");
    const second = await auth.api.signInEmail({
      body: { email: u.email, password: u.password },
      returnHeaders: true,
    });
    const cookie2 = second.headers
      .getSetCookie()
      .map(c => c.split(";")[0])
      .join("; ");
    const tok = await container().services.tokens.create(
      { userId: u.id },
      { name: "ci", scope: "read" },
    );
    expect(await sessionOf(u.cookie)).not.toBeNull();
    expect(await container().services.tokens.verify(tok.token)).not.toBeNull();

    await auth.api.requestPasswordReset({
      body: { email: u.email, redirectTo: "/reset-password" },
    });
    await new Promise(r => setTimeout(r, 50));
    const link = sent.filter(s => s.email === u.email).at(-1)!.url;
    const token = new URL(link).pathname.split("/").pop()!;
    await auth.api.resetPassword({
      body: { newPassword: "a brand new password", token },
    });
    expect(await sessionOf(u.cookie)).toBeNull();
    expect(await sessionOf(cookie2)).toBeNull();
    expect(await container().services.tokens.verify(tok.token)).toBeNull();
    await expect(
      auth.api.resetPassword({
        body: { newPassword: "another password!", token },
      }),
    ).rejects.toBeDefined();
  });

  it("a reset link is dead after an hour", async () => {
    const u = await signUp("expiry");
    await auth.api.requestPasswordReset({
      body: { email: u.email, redirectTo: "/reset-password" },
    });
    await new Promise(r => setTimeout(r, 50));
    const token = new URL(
      sent.filter(s => s.email === u.email).at(-1)!.url,
    ).pathname
      .split("/")
      .pop()!;
    const [row] = await db()
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, `reset-password:${token}`));
    // Issued for one hour: the stored expiry is within 3600 s of now.
    const ttl = (row!.expiresAt.getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
    await db()
      .update(schema.verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.verification.id, row!.id));
    await expect(
      auth.api.resetPassword({
        body: { newPassword: "too late password", token },
      }),
    ).rejects.toBeDefined();
  });

  it("changing the password signs out other sessions and revokes tokens, keeping this one", async () => {
    const u = await signUp("change");
    const second = await auth.api.signInEmail({
      body: { email: u.email, password: u.password },
      returnHeaders: true,
    });
    const cookie2 = second.headers
      .getSetCookie()
      .map(c => c.split(";")[0])
      .join("; ");
    const tok = await container().services.tokens.create(
      { userId: u.id },
      { name: "t", scope: "read" },
    );
    const changed = await auth.api.changePassword({
      body: { currentPassword: u.password, newPassword: "changed password 1" },
      headers: new Headers({ cookie: u.cookie }),
      returnHeaders: true,
    });
    // The response carries a fresh cookie for this browser; the old cookies are dead.
    const fresh = changed.headers
      .getSetCookie()
      .map(c => c.split(";")[0])
      .join("; ");
    expect(await sessionOf(fresh)).not.toBeNull();
    expect(await sessionOf(u.cookie)).toBeNull();
    expect(await sessionOf(cookie2)).toBeNull();
    expect(await container().services.tokens.verify(tok.token)).toBeNull();
  });
});

describe("M9-AZ-1 / AZ-3 sign out everywhere", () => {
  it("401 without a session, 403 with a token", async () => {
    for (const id of ["signOutEverywhere", "resendVerification"] as const) {
      expect((await call(id, {})).status).toBe(401);
      const u = await createUser("azt");
      const tok = await container().services.tokens.create(u.actor, {
        name: "x",
        scope: "read_propose",
      });
      const r = await call(id, {
        headers: { authorization: `Bearer ${tok.token}` },
      });
      expect(r.status).toBe(403);
    }
  });

  it("ends the caller's sessions and tokens only", async () => {
    const a = await createUser("sa");
    const b = await createUser("sb");
    const ta = await container().services.tokens.create(a.actor, {
      name: "a",
      scope: "read",
    });
    const tb = await container().services.tokens.create(b.actor, {
      name: "b",
      scope: "read",
    });
    const r = await call("signOutEverywhere", { user: a });
    expect(r.status).toBe(204);
    expect((await call("me", { user: a })).status).toBe(401);
    expect(await container().services.tokens.verify(ta.token)).toBeNull();
    expect((await call("me", { user: b })).status).toBe(200);
    expect(await container().services.tokens.verify(tb.token)).not.toBeNull();
  });
});

describe("M9-AZ-6 expired and revoked tokens", () => {
  it("are rejected on every route class", async () => {
    const u = await createUser("exp");
    const t = await container().services.tokens.create(u.actor, {
      name: "e",
      scope: "read",
    });
    await db()
      .update(schema.apiTokens)
      .set({
        createdAt: new Date(Date.now() - 3_600_000),
        expiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(schema.apiTokens.id, t.id));
    for (const id of ["me", "listBudgets", "listTokens"] as const)
      expect(
        (await call(id, { headers: { authorization: `Bearer ${t.token}` } }))
          .status,
      ).toBe(401);
  });
});
