import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPlaidKeyStore,
  verifyPlaidWebhook,
  type PlaidJwk,
} from "./plaid-webhook";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const jwk = publicKey.export({ format: "jwk" }) as PlaidJwk;
const NOW = 1_800_000_000_000;
const body = '{"webhook_type":"TRANSACTIONS"}';

function token(o: { kid?: string; iat?: number; alg?: string; hash?: string }) {
  const enc = (x: unknown) =>
    Buffer.from(JSON.stringify(x)).toString("base64url");
  const h = enc({ alg: o.alg ?? "ES256", kid: o.kid ?? "key1" });
  const p = enc({
    iat: o.iat ?? NOW / 1000,
    request_body_sha256:
      o.hash ?? createHash("sha256").update(body).digest("hex"),
  });
  const sig = sign("sha256", Buffer.from(`${h}.${p}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${h}.${p}.${sig}`;
}

describe("M9-U-9 / M9-U-19 Plaid webhook verification", () => {
  const verify = (t: string, getKey = async () => jwk, rawBody = body) =>
    verifyPlaidWebhook({ token: t, rawBody, getKey, now: () => NOW });

  it("accepts a valid token", async () => {
    expect(await verify(token({}))).toBe(true);
  });

  it("an unusual kid makes zero key lookups", async () => {
    let calls = 0;
    const getKey = async () => (calls++, jwk);
    for (const kid of ["a/b", "../x", "a".repeat(65), "a b", "k%00"])
      expect(await verify(token({ kid }), getKey)).toBe(false);
    expect(calls).toBe(0);
  });

  it("rejects iat in the future, stale iat, alg none/HS256 and a body mismatch", async () => {
    expect(await verify(token({ iat: NOW / 1000 + 120 }))).toBe(false);
    expect(await verify(token({ iat: NOW / 1000 - 400 }))).toBe(false);
    expect(await verify(token({ alg: "none" }))).toBe(false);
    expect(await verify(token({ alg: "HS256" }))).toBe(false);
    expect(await verify(token({}), async () => jwk, body + " ")).toBe(false);
  });

  it("rejects a key past its own expiry", async () => {
    const expired = { ...jwk, expired_at: NOW / 1000 - 1 };
    expect(await verify(token({}), async () => expired)).toBe(false);
  });
});

describe("M9-U-9 key store bounds", () => {
  it("1000 distinct kids: cache stays at 16 and at most 10 lookups a minute", async () => {
    let t = NOW;
    let outbound = 0;
    const store = createPlaidKeyStore({
      now: () => t,
      fetchKey: async () => (outbound++, jwk),
    });
    for (let i = 0; i < 1000; i++) await store(`k${i}`).catch(() => undefined);
    expect(outbound).toBe(10);
    t += 61_000;
    for (let i = 0; i < 1000; i++) await store(`m${i}`).catch(() => undefined);
    expect(outbound).toBe(20);
  });

  it("holds at most 16 keys and expires after 24h", async () => {
    let t = NOW;
    let outbound = 0;
    const store = createPlaidKeyStore({
      now: () => t,
      maxLookupsPerMinute: 1000,
      fetchKey: async () => (outbound++, jwk),
    });
    for (let i = 0; i < 40; i++) await store(`k${i}`);
    expect(outbound).toBe(40);
    await store("k39"); // newest still cached
    expect(outbound).toBe(40);
    await store("k0"); // evicted
    expect(outbound).toBe(41);
    t += 24 * 3_600_000 + 1;
    await store("k0");
    expect(outbound).toBe(42);
  });

  it("negative-caches failures for 60s and never stores them as keys", async () => {
    let t = NOW;
    let outbound = 0;
    const store = createPlaidKeyStore({
      now: () => t,
      fetchKey: async () => {
        outbound++;
        throw new Error("500 from plaid");
      },
    });
    await expect(store("bad")).rejects.toThrow("key_unavailable");
    await expect(store("bad")).rejects.toThrow("key_unavailable");
    expect(outbound).toBe(1);
    t += 61_000;
    await expect(store("bad")).rejects.toThrow();
    expect(outbound).toBe(2);
  });
});
