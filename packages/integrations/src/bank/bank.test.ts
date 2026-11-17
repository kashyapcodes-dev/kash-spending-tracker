/**
 * Fixtures are hand-written from the providers' documentation (not recorded from live calls):
 * Plaid /transactions/sync and SimpleFIN protocol 2.0 as read on 2026-11-14.
 */
import { describe, expect, it } from "vitest";
import { plaidProvider } from "./plaid";
import { simplefinProvider } from "./simplefin";
import { ProviderError } from "./types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("M5-U-6 Plaid adapter", () => {
  const page1 = {
    added: [
      {
        transaction_id: "t1",
        account_id: "a1",
        date: "2026-11-02",
        amount: 12.5,
        name: "TRADER JOES",
        merchant_name: "Trader Joe's",
        pending: false,
      },
      {
        transaction_id: "t2",
        account_id: "a1",
        date: "2026-11-03",
        amount: -1000,
        name: "PAYROLL",
        pending: true,
      },
    ],
    modified: [],
    removed: [],
    next_cursor: "c1",
    has_more: true,
  };
  const page2 = {
    added: [],
    modified: [
      {
        transaction_id: "t1",
        account_id: "a1",
        date: "2026-11-02",
        amount: 13.0,
        name: "TRADER JOES",
        pending: false,
      },
    ],
    removed: [{ transaction_id: "t9" }],
    next_cursor: "c2",
    has_more: false,
  };
  it("pages, maps signs, carries pending, filters by since", async () => {
    const bodies: Record<string, unknown>[] = [];
    const pages = [page1, page2];
    const p = plaidProvider({
      clientId: "cid",
      secret: "sec",
      env: "sandbox",
      fetch: async (_u, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json(pages.shift());
      },
    });
    const r = await p.sync("access-xyz", null, "2026-11-01");
    expect(r.added).toEqual([
      {
        externalId: "t1",
        accountExternalId: "a1",
        date: "2026-11-02",
        name: "Trader Joe's",
        amountCents: 1250,
        type: "expense",
        pending: false,
      },
      {
        externalId: "t2",
        accountExternalId: "a1",
        date: "2026-11-03",
        name: "PAYROLL",
        amountCents: 100000,
        type: "income",
        pending: true,
      },
    ]);
    expect(r.modified[0]).toMatchObject({
      externalId: "t1",
      amountCents: 1300,
    });
    expect(r.removedIds).toEqual(["t9"]);
    expect(r.nextCursor).toBe("c2");
    expect(bodies[1]).toMatchObject({
      cursor: "c1",
      access_token: "access-xyz",
    });
  });
  it("login required is an auth error without echoing the body", async () => {
    const p = plaidProvider({
      clientId: "cid",
      secret: "sec",
      env: "sandbox",
      fetch: async () =>
        json(
          {
            error_code: "ITEM_LOGIN_REQUIRED",
            error_message: "access-secret-123",
          },
          400,
        ),
    });
    const err = await p
      .sync("access-secret-123", null, "2026-01-01")
      .catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("auth");
    expect(err.message).not.toContain("access-secret-123");
  });
  it("isConfigured needs both credentials", () => {
    expect(plaidProvider({ env: "sandbox" }).isConfigured()).toBe(false);
    expect(
      plaidProvider({
        clientId: "a",
        secret: "b",
        env: "sandbox",
      }).isConfigured(),
    ).toBe(true);
  });
});

describe("M5-U-7 SimpleFIN adapter", () => {
  const accessUrl = "https://user:pass@bridge.example/simplefin";
  it("claims a setup token for an access URL", async () => {
    const claim = "https://bridge.example/simplefin/claim/abc";
    let called = "";
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      fetch: async (u, init) => (
        (called = `${init?.method} ${u}`),
        new Response(accessUrl)
      ),
    });
    const r = await p.completeLink({
      setupToken: Buffer.from(claim).toString("base64"),
    });
    expect(r.secret).toBe(accessUrl);
    expect(called).toBe(`POST ${claim}`);
  });
  it("an already used token (403) is an auth error", async () => {
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      fetch: async () => new Response("", { status: 403 }),
    });
    const err = await p
      .completeLink({
        setupToken: Buffer.from("https://x/claim").toString("base64"),
      })
      .catch(e => e);
    expect(err.kind).toBe("auth");
  });
  it("lists accounts and syncs a window with Basic auth, normalising signs", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const data = {
      errlist: [],
      accounts: [
        {
          id: "A1",
          name: "Checking",
          transactions: [
            {
              id: "x1",
              posted: Date.parse("2026-11-02T12:00:00Z") / 1000,
              amount: "-12.50",
              description: "Trader Joes",
            },
            {
              id: "x2",
              posted: Date.parse("2026-11-03T12:00:00Z") / 1000,
              amount: "1000.00",
              description: "Payroll",
            },
            {
              id: "x3",
              posted: 0,
              amount: "-3.00",
              description: "Pending thing",
              pending: true,
            },
          ],
        },
      ],
    };
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      now: () => Date.parse("2026-11-10T00:00:00Z"),
      fetch: async (u, init) => {
        seen.push({
          url: String(u),
          auth: new Headers(init?.headers).get("authorization"),
        });
        return json(data);
      },
    });
    const r = await p.sync(accessUrl, null, "2026-11-01");
    expect(
      r.added.map(t => [t.externalId, t.type, t.amountCents, t.pending]),
    ).toEqual([
      ["A1:x1", "expense", 1250, false],
      ["A1:x2", "income", 100000, false],
      ["A1:x3", "expense", 300, true],
    ]);
    expect(seen[0]?.auth).toBe(
      `Basic ${Buffer.from("user:pass").toString("base64")}`,
    );
    expect(seen[0]?.url).not.toContain("user:pass");
    expect(seen[0]?.url).toContain("version=2");
    expect(r.nextCursor).toBeNull();
  });
  it("splits a long range into windows of at most 90 days", async () => {
    let n = 0;
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      now: () => Date.parse("2026-11-10T00:00:00Z"),
      fetch: async () => (n++, json({ errlist: [], accounts: [] })),
    });
    await p.sync(accessUrl, null, "2026-01-01");
    expect(n).toBe(4); // 314 days in windows of at most 90
  });
  it("con.auth in errlist is an auth error", async () => {
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      fetch: async () =>
        json({ errlist: [{ code: "con.auth", msg: "x" }], accounts: [] }),
    });
    const err = await p.sync(accessUrl, null, "2026-11-01").catch(e => e);
    expect(err.kind).toBe("auth");
  });
});
