/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely typed JSON */
import { describe, expect, it, vi } from "vitest";
import type { Config } from "@kash/core";
import { logError, safeCode, scrubSecrets } from "@kash/core";
import { deliverResetLink } from "@/server/mailer";
import { call, createUser, seedCategory } from "./helpers";

const link = "http://localhost:3000/reset-password?token=SECRETTOKEN123";
const cfg = (extra: object = {}) => ({ ...extra }) as unknown as Config;

describe("M9-U-15 reset links in the log", () => {
  it("no SMTP: nothing containing the link is logged by default", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await deliverResetLink(cfg(), "a@example.test", link);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("KASH_LOG_RESET_LINKS=true restores it", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await deliverResetLink(
      cfg({ KASH_LOG_RESET_LINKS: true }),
      "a@example.test",
      link,
    );
    expect(spy.mock.calls.flat().join(" ")).toContain("SECRETTOKEN123");
    spy.mockRestore();
  });
});

describe("M9-U-14 stored error text", () => {
  it("a failed approval stores a fixed reason, not the raw message", async () => {
    const u = await createUser("scrub");
    await seedCategory(u, u.budgetId, "Taken");
    const p = await call<any>("createProposal", {
      user: u,
      params: { budgetId: u.budgetId },
      body: {
        summary: "S",
        operations: [
          { op: "category.create", data: { name: "Fresh" } },
          { op: "category.create", data: { name: "Taken" } },
        ],
      },
    });
    expect(p.status).toBe(201);
    await call("approveProposal", {
      user: u,
      params: { budgetId: u.budgetId, proposalId: p.body.id },
      body: {},
    });
    const got = await call<any>("getProposal", {
      user: u,
      params: { budgetId: u.budgetId, proposalId: p.body.id },
    });
    expect(got.body.status).toBe("failed");
    expect(JSON.stringify(got.body.result)).not.toMatch(/Taken|duplicate/i);
    expect(got.body.result.reason).toMatch(/could not be applied/);
  });

  it("scrubbing helpers", () => {
    expect(scrubSecrets("GET https://user:pw@bridge.example/x")).not.toMatch(
      /user|pw@/,
    );
    expect(scrubSecrets("Authorization: Bearer abc.def-ghi")).not.toContain(
      "abc.def",
    );
    expect(scrubSecrets("password=hunter2&x=1")).not.toContain("hunter2");
    expect(safeCode({ code: "23505" })).toBe("23505");
    expect(safeCode({ code: "has spaces and secrets" })).toBe("error");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("t", new Error("fail https://u:p@h.example key=abc"));
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/u:p@|key=abc/);
    spy.mockRestore();
  });
});
