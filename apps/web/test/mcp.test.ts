/* eslint-disable @typescript-eslint/no-explicit-any -- MCP tool results are loosely typed JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiClient } from "@kash/api-client";
import { endpoints } from "@kash/contract";
import { createKashMcpServer, MCP_TOOL_NAMES } from "@kash/mcp";
import { routeHandlers } from "./routes";
import {
  call,
  container,
  createUser,
  inviteAndAccept,
  seedCategory,
  seedTransaction,
  snapshot,
  type TestUser,
} from "./helpers";

/** A fetch that dispatches to the route handlers, as the real server would. */
const routeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost:3000");
  const method = (init?.method ?? "GET").toLowerCase();
  for (const def of endpoints) {
    if (def.method !== method) continue;
    const names: string[] = [];
    const re = new RegExp(
      `^${def.path.replace(/\{(\w+)\}/g, (_m, n: string) => (names.push(n), "([^/]+)"))}$`,
    );
    const m = re.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(
      names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]),
    );
    return routeHandlers[def.id as keyof typeof routeHandlers](
      new Request(url, init),
      {
        params: Promise.resolve(params),
      },
    );
  }
  return new Response("{}", { status: 404 });
};

async function connect(token: string) {
  const client = createApiClient({
    fetch: routeFetch,
    headers: () => ({ authorization: `Bearer ${token}` }),
  });
  const server = createKashMcpServer({ client });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(b);
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const r: any = await mcp.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? "";
    return {
      isError: Boolean(r.isError),
      text,
      json: r.isError ? null : JSON.parse(text),
    };
  };
  return { mcp, callTool };
}

let owner: TestUser;
let other: TestUser;
let budget: string;
const mk = async (
  u: TestUser,
  scope: "read" | "read_propose",
  budgetIds?: string[],
) =>
  (
    await container().services.tokens.create(u.actor, {
      name: `mcp-${Math.random().toString(36).slice(2)}`,
      scope,
      budgetIds,
    })
  ).token;

beforeAll(async () => {
  owner = await createUser("mcpo");
  other = await createUser("mcpx");
  budget = owner.budgetId;
  const cat = await seedCategory(owner, budget, "Coffee");
  await seedTransaction(owner, budget, {
    name: "Blue Bottle",
    amountCents: 450,
    categoryId: cat.id,
    date: "2026-10-05",
  });
  await inviteAndAccept(owner, budget, other, "viewer");
});

describe("M7-MCP", () => {
  it("MCP-1 lists the tools with schemas", async () => {
    const { mcp } = await connect(await mk(owner, "read_propose"));
    const { tools } = await mcp.listTools();
    expect(tools.map(t => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    const propose = tools.find(t => t.name === "propose_change")!;
    expect(JSON.stringify(propose.inputSchema)).toContain("operations");
    expect(JSON.stringify(propose.inputSchema)).toContain("budgetId");
  });

  it("MCP-2 a read tool returns the same data as the API", async () => {
    const { callTool } = await connect(await mk(owner, "read"));
    const api = await call<any>("reportSummary", {
      user: owner,
      params: { budgetId: budget },
      query: { from: "2026-10-01", to: "2026-10-31" },
    });
    const r = await callTool("summarize_period", {
      budgetId: budget,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(r.json).toEqual(api.body);
    const t = await callTool("query_transactions", {
      budgetId: budget,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(t.json.items).toHaveLength(1);
    const b = await callTool("list_budgets", {});
    expect(b.json.items.map((x: any) => x.id)).toContain(budget);
  });

  it("MCP-3 propose_change creates a pending proposal with origin mcp, visible to the user", async () => {
    const { callTool } = await connect(await mk(owner, "read_propose"));
    const before = (await snapshot(budget)).transactions;
    const r = await callTool("propose_change", {
      budgetId: budget,
      summary: "Add tea",
      operations: [
        {
          op: "transaction.create",
          data: {
            type: "expense",
            name: "Tea",
            amountCents: 300,
            date: "2026-11-01",
          },
        },
      ],
    });
    expect(r.isError).toBe(false);
    const list = await call<any>("listProposals", {
      user: owner,
      params: { budgetId: budget },
      query: { status: "pending" },
    });
    expect(
      list.body.items.find((p: any) => p.id === r.json.proposal.id),
    ).toMatchObject({ origin: "mcp", status: "pending" });
    expect((await snapshot(budget)).transactions).toEqual(before);
  });

  it("MCP-4 no tool approves, and the token cannot approve through the API", async () => {
    const token = await mk(owner, "read_propose");
    const { mcp, callTool } = await connect(token);
    expect(
      (await mcp.listTools()).tools.some(t => /approve|reject/.test(t.name)),
    ).toBe(false);
    const made = await callTool("propose_change", {
      budgetId: budget,
      summary: "x",
      operations: [{ op: "category.create", data: { name: "ViaMcp" } }],
    });
    const id = made.json.proposal.id;
    const res = await routeFetch(
      `/api/v1/budgets/${budget}/proposals/${id}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(403);
    expect(
      (
        await call<any>("getProposal", {
          user: owner,
          params: { budgetId: budget, proposalId: id },
        })
      ).body.status,
    ).toBe("pending");
  });

  it("MCP-5 a read token cannot propose; a budget-limited token cannot see other budgets", async () => {
    const read = await connect(await mk(owner, "read"));
    const denied = await read.callTool("propose_change", {
      budgetId: budget,
      summary: "x",
      operations: [{ op: "category.create", data: { name: "No" } }],
    });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("403");
    // owner is a member of both budgets; the token is limited to a different one
    const spare = await container().services.budgets.create(owner.actor, {
      name: "Spare",
    } as never);
    const limited = await connect(await mk(owner, "read", [spare.id]));
    const r = await limited.callTool("list_categories", { budgetId: budget });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("404");
    const list = await limited.callTool("list_budgets", {});
    expect(list.json.items.map((b: any) => b.id)).toEqual([spare.id]);
  });
});
