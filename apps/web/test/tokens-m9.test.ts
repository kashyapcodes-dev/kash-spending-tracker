/* eslint-disable @typescript-eslint/no-explicit-any -- tests read loosely typed JSON */
import { describe, expect, it } from "vitest";
import { call, createUser } from "./helpers";

const make = (user: any, body: Record<string, unknown>) =>
  call<any>("createToken", {
    user,
    body: { name: "t", scope: "read", ...body },
  });
const day = 86_400_000;

describe("M9-U-16 token creation", () => {
  it("rejects past and more-than-a-year expiry with 422", async () => {
    const u = await createUser("tok1");
    expect(
      (await make(u, { expiresAt: new Date(Date.now() - day).toISOString() }))
        .status,
    ).toBe(422);
    expect(
      (
        await make(u, {
          expiresAt: new Date(Date.now() + 400 * day).toISOString(),
        })
      ).status,
    ).toBe(422);
  });

  it("defaults to 90 days; explicit null means never", async () => {
    const u = await createUser("tok2");
    const a = await make(u, { name: "default" });
    expect(a.status).toBe(201);
    const days = (Date.parse(a.body.expiresAt) - Date.now()) / day;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
    const b = await make(u, { name: "forever", expiresAt: null });
    expect(b.body.expiresAt).toBeNull();
  });

  it("duplicate name is 409 and the 21st active token is refused", async () => {
    const u = await createUser("tok3");
    expect((await make(u, { name: "dup" })).status).toBe(201);
    expect((await make(u, { name: "dup" })).status).toBe(409);
    for (let i = 1; i < 20; i++)
      expect((await make(u, { name: `n${i}` })).status).toBe(201);
    expect((await make(u, { name: "one-too-many" })).status).toBe(422);
  });

  it("another user may reuse a name", async () => {
    const a = await createUser("tok4");
    const b = await createUser("tok5");
    expect((await make(a, { name: "same" })).status).toBe(201);
    expect((await make(b, { name: "same" })).status).toBe(201);
  });
});
