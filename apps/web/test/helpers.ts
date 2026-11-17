/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely typed JSON; responses are validated against the contract in `call` */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { schema } from "@kash/db";
import {
  agentEventSchema,
  endpoints,
  errorResponseSchema,
  type EndpointId,
  type Role,
} from "@kash/contract";
import type { Actor } from "@kash/core";
import { getContainer } from "@/server/container";
import { routeHandlers } from "./routes";

export const container = () => getContainer();
export const db = () => getContainer().db.db;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  cookie: string;
  actor: Actor;
  /** The "My Budget" created at signup. */
  budgetId: string;
}

/** Sign up through Better Auth (the real signup path) and capture the session cookie. */
export async function createUser(label = "user"): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = "correct horse battery";
  const { headers, response } = await container().auth.api.signUpEmail({
    body: { name: label, email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map(c => c.split(";")[0])
    .join("; ");
  const [m] = await db()
    .select({ budgetId: schema.budgetMembers.budgetId })
    .from(schema.budgetMembers)
    .where(eq(schema.budgetMembers.userId, response.user.id));
  return {
    id: response.user.id,
    email,
    password,
    cookie,
    actor: { userId: response.user.id },
    budgetId: m?.budgetId ?? "",
  };
}

export async function addMember(budgetId: string, userId: string, role: Role) {
  await db()
    .insert(schema.budgetMembers)
    .values({ budgetId, userId, role })
    .onConflictDoUpdate({
      target: [schema.budgetMembers.budgetId, schema.budgetMembers.userId],
      set: { role },
    });
}

/** The token at the end of an `inviteUrl`. */
export const tokenOf = (inviteUrl: string) => inviteUrl.split("/").pop() ?? "";

/** Invite `invitee` to the budget and accept as them, through the real endpoints. */
export async function inviteAndAccept(
  owner: TestUser,
  budgetId: string,
  invitee: TestUser,
  role: "editor" | "viewer",
) {
  const created = await call<{ inviteUrl: string }>("createInvite", {
    user: owner,
    params: { budgetId },
    body: { email: invitee.email, role },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const accepted = await call("acceptInvite", {
    user: invitee,
    params: { token: tokenOf(created.body.inviteUrl) },
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
}

export async function createBudgetFor(owner: TestUser, name = "Extra Budget") {
  return container().services.budgets.create(owner.actor, { name });
}

export interface CallOptions {
  user?: TestUser | undefined;
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
}

export interface CallResult<T = unknown> {
  status: number;
  body: T;
}

/** Call a route handler as the real server would, and check the response against the contract (M1-API-10). */
export async function call<T = any>(
  id: EndpointId,
  opts: CallOptions = {},
): Promise<CallResult<T>> {
  const def = endpoints.find(e => e.id === id);
  if (!def) throw new Error(`unknown endpoint ${id}`);
  let path: string = def.path;
  for (const [k, v] of Object.entries(opts.params ?? {}))
    path = path.replace(`{${k}}`, v);
  const url = new URL(`http://localhost:3000${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {}))
    if (v !== undefined) url.searchParams.set(k, String(v));

  const headers = new Headers(opts.headers);
  if (opts.user) {
    headers.set("cookie", opts.user.cookie);
    // A browser adds this on same-origin requests; the API refuses cookie writes without it.
    if (!headers.has("sec-fetch-site"))
      headers.set("sec-fetch-site", "same-origin");
  }
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const res = await routeHandlers[id](
    new Request(url, { method: def.method.toUpperCase(), headers, body }),
    {
      params: Promise.resolve(opts.params ?? {}),
    },
  );
  const text = await res.text();
  // Server-sent events: check every event against the contract and return them as an array.
  if (res.headers.get("content-type")?.startsWith("text/event-stream")) {
    const events = text
      .split("\n\n")
      .filter(Boolean)
      .map(b => JSON.parse(b.replace(/^data: /, "")) as unknown);
    for (const e of events)
      expect(
        agentEventSchema.safeParse(e).success,
        `bad stream event from ${id}: ${JSON.stringify(e)}`,
      ).toBe(true);
    return { status: res.status, body: events as T };
  }
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (res.status === def.success.status) {
    const r = def.success.schema.safeParse(parsed);
    expect(
      r.success,
      `response of ${id} violates its contract: ${JSON.stringify(r.error?.issues)}`,
    ).toBe(true);
  } else {
    expect(
      res.status,
      `unexpected status ${res.status} for ${id}: ${text}`,
    ).toBeGreaterThanOrEqual(400);
    const r = errorResponseSchema.safeParse(parsed);
    expect(
      r.success,
      `error body of ${id} violates the error contract: ${text}`,
    ).toBe(true);
  }
  return { status: res.status, body: parsed as T };
}

/** A full picture of one budget's rows, for "nothing changed" assertions. */
export async function snapshot(budgetId: string) {
  const d = db();
  return {
    budget: await d
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.id, budgetId)),
    categories: await d
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.budgetId, budgetId))
      .orderBy(schema.categories.id),
    transactions: await d
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.budgetId, budgetId))
      .orderBy(schema.transactions.id),
    members: await d
      .select()
      .from(schema.budgetMembers)
      .where(eq(schema.budgetMembers.budgetId, budgetId))
      .orderBy(schema.budgetMembers.userId),
    dashboards: await d
      .select()
      .from(schema.dashboards)
      .where(eq(schema.dashboards.budgetId, budgetId))
      .orderBy(schema.dashboards.id),
    targets: await d
      .select()
      .from(schema.categoryTargets)
      .where(eq(schema.categoryTargets.budgetId, budgetId))
      .orderBy(schema.categoryTargets.id),
    invites: await d
      .select()
      .from(schema.budgetInvites)
      .where(eq(schema.budgetInvites.budgetId, budgetId))
      .orderBy(schema.budgetInvites.id),
    presets: await d
      .select()
      .from(schema.importPresets)
      .where(eq(schema.importPresets.budgetId, budgetId))
      .orderBy(schema.importPresets.id),
    batches: await d
      .select()
      .from(schema.importBatches)
      .where(eq(schema.importBatches.budgetId, budgetId))
      .orderBy(schema.importBatches.id),
    staged: await d
      .select()
      .from(schema.stagedTransactions)
      .where(eq(schema.stagedTransactions.budgetId, budgetId))
      .orderBy(schema.stagedTransactions.id),
    connections: await d
      .select()
      .from(schema.bankConnections)
      .where(eq(schema.bankConnections.budgetId, budgetId))
      .orderBy(schema.bankConnections.id),
    proposals: await d
      .select()
      .from(schema.agentProposals)
      .where(eq(schema.agentProposals.budgetId, budgetId))
      .orderBy(schema.agentProposals.id),
    conversations: await d
      .select()
      .from(schema.aiConversations)
      .where(eq(schema.aiConversations.budgetId, budgetId))
      .orderBy(schema.aiConversations.id),
  };
}

export async function seedCategory(
  user: TestUser,
  budgetId: string,
  name: string,
) {
  return container().services.categories.create(user.actor, budgetId, { name });
}

export async function seedTransaction(
  user: TestUser,
  budgetId: string,
  t: {
    type?: "expense" | "income";
    name?: string;
    amountCents?: number;
    date?: string;
    categoryId?: string | null;
  },
) {
  const [row] = await container().services.transactions.createMany(
    user.actor,
    budgetId,
    [
      {
        type: t.type ?? "expense",
        name: t.name ?? "Thing",
        amountCents: t.amountCents ?? 1000,
        date: t.date ?? "2026-11-05",
        categoryId: t.categoryId ?? null,
      },
    ],
  );
  if (!row) throw new Error("no row");
  return row;
}

export async function memberRole(budgetId: string, userId: string) {
  const [r] = await db()
    .select({ role: schema.budgetMembers.role })
    .from(schema.budgetMembers)
    .where(
      and(
        eq(schema.budgetMembers.budgetId, budgetId),
        eq(schema.budgetMembers.userId, userId),
      ),
    );
  return r?.role;
}

const PRESET_MAPPING = {
  version: 1,
  hasHeader: true,
  delimiter: ",",
  columns: { date: "Date", name: "Name", amount: "Amt" },
  dateFormat: "auto",
  amountSign: "positive_is_expense",
  importIncome: false,
};
export { PRESET_MAPPING };

/** A preset owned by the budget. */
export async function seedPreset(budgetId: string, name = "Fixture preset") {
  const [row] = await db()
    .insert(schema.importPresets)
    .values({ budgetId, name, mapping: PRESET_MAPPING })
    .returning();
  return row as NonNullable<typeof row>;
}

/** A batch with one pending staged row (written directly, as the sync job would). */
export async function seedStaged(
  budgetId: string,
  over: Partial<typeof schema.stagedTransactions.$inferInsert> = {},
) {
  const [batch] = await db()
    .insert(schema.importBatches)
    .values({ budgetId, source: "csv", label: "fixture.csv" })
    .returning();
  const [row] = await db()
    .insert(schema.stagedTransactions)
    .values({
      budgetId,
      batchId: (batch as NonNullable<typeof batch>).id,
      source: "csv",
      type: "expense",
      name: "Staged coffee",
      amountCents: 450,
      date: "2026-11-05",
      ...over,
    })
    .returning();
  return {
    batchId: (batch as NonNullable<typeof batch>).id,
    stagedId: (row as NonNullable<typeof row>).id,
  };
}
