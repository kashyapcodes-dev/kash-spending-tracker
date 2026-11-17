/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely typed JSON */
import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  call,
  createBudgetFor,
  createUser,
  type TestUser,
} from "./helpers";
import { routeHandlers } from "./routes";

let owner: TestUser;
let budgetId: string;
beforeAll(async () => {
  owner = await createUser("sec");
  budgetId = (await createBudgetFor(owner, "Sec")).id;
});

const url = () => `http://localhost:3000/api/v1/budgets/${budgetId}/categories`;
const post = (headers: Record<string, string>, body: BodyInit, extra = {}) =>
  routeHandlers.createCategory(
    new Request(url(), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      ...extra,
    }),
    { params: Promise.resolve({ budgetId }) },
  );

describe("M9-U-22 CSRF", () => {
  const body = () => JSON.stringify({ name: `c-${Math.random()}` });

  it("refuses cookie writes with a foreign Origin or cross-site fetch metadata", async () => {
    const cookie = owner.cookie;
    expect(
      (await post({ cookie, origin: "https://evil.example" }, body())).status,
    ).toBe(403);
    expect(
      (await post({ cookie, "sec-fetch-site": "cross-site" }, body())).status,
    ).toBe(403);
    expect(
      (await post({ cookie, "sec-fetch-site": "same-site" }, body())).status,
    ).toBe(403);
  });

  it("refuses cookie writes carrying no origin evidence at all", async () => {
    expect((await post({ cookie: owner.cookie }, body())).status).toBe(403);
  });

  it("accepts same-origin cookie writes", async () => {
    expect(
      (
        await post(
          { cookie: owner.cookie, "sec-fetch-site": "same-origin" },
          body(),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          { cookie: owner.cookie, origin: "http://localhost:3000" },
          body(),
        )
      ).status,
    ).toBe(201);
  });

  it("a cross-site request is refused even with a bogus bearer", async () => {
    expect(
      (
        await post(
          { authorization: "Bearer x", "sec-fetch-site": "cross-site" },
          body(),
        )
      ).status,
    ).toBe(403);
  });
});

describe("M9-U-10 body limits", () => {
  it("a 2 MB JSON body is 413 and is not read in full", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += chunk.length;
        if (pulled > 4 * 1024 * 1024) return c.close();
        c.enqueue(chunk);
      },
    });
    const res = await post(
      { cookie: owner.cookie, "sec-fetch-site": "same-origin" },
      stream,
      { duplex: "half" },
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
    // Stopped soon after the 1 MB cap, nowhere near the 4 MB on offer.
    expect(pulled).toBeLessThan(2 * 1024 * 1024);
  });

  it("a lying Content-Length does not widen the cap", async () => {
    const big = "x".repeat(1_200_000);
    const res = await post(
      {
        cookie: owner.cookie,
        "sec-fetch-site": "same-origin",
        "content-length": "10",
      },
      JSON.stringify({ name: big }),
    );
    expect(res.status).toBe(413);
  });

  it("a CSV of 5 MB plus one byte plus overhead is 413; a small one is not", async () => {
    const form = (n: number) => {
      const f = new FormData();
      f.set("file", new File(["a".repeat(n)], "x.csv", { type: "text/csv" }));
      return f;
    };
    const big = await call("analyzeCsv", {
      user: owner,
      params: { budgetId },
      formData: form(5 * 1024 * 1024 + 70 * 1024),
    });
    expect(big.status).toBe(413);
    const small = await call("analyzeCsv", {
      user: owner,
      params: { budgetId },
      formData: form(100),
    });
    expect(small.status).not.toBe(413);
  });
});

describe("M9-AZ-2 member emails", () => {
  it("only owners see other members' emails; everyone sees their own", async () => {
    const o = await createUser("mo");
    const ed = await createUser("me");
    const vw = await createUser("mv");
    const b = (await createBudgetFor(o, "Members")).id;
    await addMember(b, ed.id, "editor");
    await addMember(b, vw.id, "viewer");
    const list = async (u: TestUser) =>
      (
        await call<{ items: { userId: string; email?: string }[] }>(
          "listMembers",
          { user: u, params: { budgetId: b } },
        )
      ).body.items;
    const asOwner = await list(o);
    expect(asOwner.every(m => typeof m.email === "string")).toBe(true);
    for (const u of [ed, vw]) {
      const rows = await list(u);
      expect(rows).toHaveLength(3);
      for (const m of rows) {
        if (m.userId === u.id) expect(m.email).toBe(u.email);
        else expect("email" in m).toBe(false);
      }
    }
  });
});

describe("M9 widget batch cost", () => {
  it("refuses a batch whose estimated cost is too high, cheap batches still run", async () => {
    const q = (i: number) => ({
      source: "transactions",
      measure: "sum",
      groupBy: "day",
      filters: {
        dateRange: { from: "2000-01-01", to: "2026-12-31" },
        nameContains: `x${i}`,
      },
    });
    const body = (n: number) => ({
      queries: Array.from({ length: n }, (_, i) => q(i)),
    });
    const big = await call<any>("queryWidgets", {
      user: owner,
      params: { budgetId },
      body: body(30),
    });
    expect(big.status).toBe(422);
    expect(big.body.error.message).toMatch(/too expensive/);
    const small = await call<any>("queryWidgets", {
      user: owner,
      params: { budgetId },
      body: {
        queries: [
          {
            source: "transactions",
            measure: "sum",
            groupBy: "none",
            filters: {},
          },
        ],
      },
    });
    expect(small.status).toBe(200);
  });
});

describe("M9-API-3 / M9-API-4", () => {
  it("session cookie: HttpOnly, SameSite=Lax, Secure only on https", async () => {
    const { createAuth } = await import("@kash/core");
    const { db } = await import("./helpers");
    const make = (baseURL: string) =>
      createAuth({
        db: db(),
        secret: "cookie-secret-cookie-secret-cookie-secret-1",
        baseURL,
        disableRateLimit: true,
        sendResetPassword: () => undefined,
      });
    const cookieFor = async (baseURL: string) => {
      const r = await make(baseURL).api.signUpEmail({
        body: {
          name: "Cookie",
          email: `ck-${Math.random()}@example.test`,
          password: "correct horse battery",
        },
        returnHeaders: true,
      });
      return r.headers.getSetCookie().find(c => /session_token/.test(c))!;
    };
    const http = await cookieFor("http://localhost:3000");
    expect(http).toMatch(/HttpOnly/i);
    expect(http).toMatch(/SameSite=Lax/i);
    expect(http).not.toMatch(/;\s*Secure/i);
    const https = await cookieFor("https://kash.example");
    expect(https).toMatch(/HttpOnly/i);
    expect(https).toMatch(/SameSite=Lax/i);
    expect(https).toMatch(/;\s*Secure/i);
  });

  it("a limited route answers 429 with retry-after and the standard error shape", async () => {
    const { container } = await import("./helpers");
    const limiter = container().limiter;
    limiter.configure({ enabled: true });
    try {
      let last: any;
      for (let i = 0; i < 12; i++)
        last = await call<any>("createToken", {
          user: owner,
          body: { name: `lim-${i}`, scope: "read" },
        });
      expect(last.status).toBe(429);
      expect(last.body.error.code).toBe("rate_limited");
    } finally {
      limiter.configure({ enabled: false });
    }
  });
});
