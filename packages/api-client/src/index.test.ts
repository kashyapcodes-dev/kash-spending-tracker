import { describe, expect, it } from "vitest";
import { endpoints } from "@kash/contract";
import { ApiError, createApiClient } from "./index";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("api client", () => {
  it("has one method per contract endpoint", () => {
    const client = createApiClient({ fetch: fakeFetch(200, {}).f });
    expect(Object.keys(client).sort()).toEqual(endpoints.map(e => e.id).sort());
  });

  it("fills path params, serialises query and body, and validates the response", async () => {
    const budgetId = "11111111-1111-4111-8111-111111111111";
    const { f, calls } = fakeFetch(200, { items: [], nextCursor: null });
    const client = createApiClient({ fetch: f, baseUrl: "http://x" });
    const page = await client.listTransactions({
      params: { budgetId },
      query: { type: "expense", limit: 10 },
    });
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(calls[0]?.url).toBe(
      `http://x/api/v1/budgets/${budgetId}/transactions?type=expense&limit=10`,
    );
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("throws ApiError with the contract error code", async () => {
    const { f } = fakeFetch(404, {
      error: { code: "not_found", message: "Budget not found" },
    });
    const client = createApiClient({ fetch: f });
    await expect(client.me()).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "not_found",
    });
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a response that violates the contract", async () => {
    const { f } = fakeFetch(200, { status: "nope" });
    await expect(createApiClient({ fetch: f }).health()).rejects.toThrow();
  });

  it("returns null for 204", async () => {
    const { f } = fakeFetch(204, null);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      await createApiClient({ fetch: f }).deleteBudget({
        params: { budgetId: id },
      }),
    ).toBeNull();
  });
});

describe("M9 rate-limit message", () => {
  it("a 429 with retry-after tells the user how long to wait", async () => {
    const client = createApiClient({
      baseUrl: "http://x.test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: "rate_limited", message: "Too many requests" },
          }),
          { status: 429, headers: { "retry-after": "120" } },
        ),
    });
    await expect(client.me()).rejects.toThrow("Try again in 2 minutes");
  });
});
