/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely typed JSON */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// This file runs with verification required; the container is created after these are set.
const mailFile = vi.hoisted(() => {
  const f = `${process.env.TMPDIR ?? "/tmp"}/kash-verify-${Date.now()}.jsonl`;
  process.env.REQUIRE_EMAIL_VERIFICATION = "true";
  process.env.KASH_MAIL_FILE = f;
  return f;
});

import { budgetScopedEndpoints } from "@kash/contract";
import { call, container, createBudgetFor, createUser } from "./helpers";

const mails = () => {
  try {
    return readFileSync(mailFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(l => JSON.parse(l) as { to: string; kind: string; url: string });
  } catch {
    return [];
  }
};

describe("M9-U-7 / M9-AZ-4 email verification required", () => {
  it("sign-up sends one verification mail; the gate holds until the link is used", async () => {
    const u = await createUser("verif");
    await new Promise(r => setTimeout(r, 100));
    const mine = mails().filter(m => m.to === u.email && m.kind === "verify");
    expect(mine).toHaveLength(1);

    // Allowed: me, resend. Everything else is 403 email_unverified.
    const me = await call<any>("me", { user: u });
    expect(me.status).toBe(200);
    expect(me.body.user.emailVerified).toBe(false);
    expect((await call("resendVerification", { user: u })).status).toBe(204);
    const gated = await call<any>("listBudgets", { user: u });
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe("email_unverified");

    // Verify with the emailed link.
    const token = new URL(mine[0]!.url).searchParams.get("token")!;
    await container().auth.api.verifyEmail({ query: { token } });
    expect((await call("listBudgets", { user: u })).status).toBe(200);
    const me2 = await call<any>("me", { user: u });
    expect(me2.body.user.emailVerified).toBe(true);
  });

  it("every budget route is 403 for the unverified member and 404 for a non-member", async () => {
    const u = await createUser("gate");
    const stranger = await createUser("gate2");
    const other = (await createBudgetFor(stranger, "Other")).id;
    for (const e of budgetScopedEndpoints) {
      const mk = (budgetId: string) =>
        Object.fromEntries(
          [...e.path.matchAll(/\{(\w+)\}/g)].map(m => [
            m[1]!,
            m[1] === "budgetId" ? budgetId : randomUUID(),
          ]),
        );
      const own = await call<any>(e.id as any, {
        user: u,
        params: mk(u.budgetId),
      });
      expect(own.status, `${e.id} for the member`).toBe(403);
      expect(own.body.error.code, e.id).toBe("email_unverified");
      const foreign = await call<any>(e.id as any, {
        user: u,
        params: mk(other),
      });
      expect(foreign.status, `${e.id} for a non-member`).toBe(404);
    }
  });

  it("accepting an invite needs a verified address", async () => {
    const u = await createUser("inv");
    const r = await call<any>("acceptInvite", {
      user: u,
      params: { token: "x".repeat(40) },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("email_unverified");
  });

  it("an unverified user can still sign out everywhere", async () => {
    const a = await createUser("ga");
    expect((await call("signOutEverywhere", { user: a })).status).toBe(204);
  });
});
