import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from "node:crypto";

export interface PlaidJwk {
  [k: string]: unknown;
  kty: string;
  crv: string;
  x: string;
  y: string;
}

export const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const b64 = (s: string) => Buffer.from(s, "base64url");

/**
 * Verify a Plaid webhook (Plaid-Verification header): ES256 JWT, signature by the key for `kid`,
 * issued within five minutes, and `request_body_sha256` equal to the SHA-256 of the raw body.
 * `getKey` fetches (and should cache) the JWK for a key id.
 */
export async function verifyPlaidWebhook(args: {
  token: string | null;
  rawBody: string;
  getKey: (kid: string) => Promise<PlaidJwk>;
  now?: () => number;
}): Promise<boolean> {
  try {
    if (!args.token) return false;
    const [h, p, sig] = args.token.split(".");
    if (!h || !p || !sig) return false;
    const header = JSON.parse(b64(h).toString("utf8")) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== "ES256" || !header.kid) return false;
    // Reject before any outbound lookup: `kid` is attacker-controlled.
    if (!KID_PATTERN.test(header.kid)) return false;
    const jwk = await args.getKey(header.kid);
    const nowSec = (args.now ?? Date.now)() / 1000;
    const expired = (jwk as { expired_at?: unknown }).expired_at;
    if (typeof expired === "number" && expired <= nowSec) return false;
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key, dsaEncoding: "ieee-p1363" },
      b64(sig),
    );
    if (!ok) return false;
    const claims = JSON.parse(b64(p).toString("utf8")) as {
      iat?: number;
      request_body_sha256?: string;
    };
    const now = (args.now ?? Date.now)() / 1000;
    if (typeof claims.iat !== "number") return false;
    if (now - claims.iat > 300 || claims.iat - now > 60) return false;
    const want = Buffer.from(claims.request_body_sha256 ?? "", "hex");
    const got = createHash("sha256").update(args.rawBody).digest();
    return want.length === got.length && timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

export interface KeyStoreOptions {
  fetchKey: (kid: string) => Promise<PlaidJwk>;
  now?: () => number;
  maxEntries?: number;
  ttlMs?: number;
  negativeTtlMs?: number;
  maxLookupsPerMinute?: number;
}

/**
 * Bounded cache of Plaid verification keys. At most `maxEntries` keys, each kept
 * `ttlMs`; failed lookups are remembered for `negativeTtlMs` (never stored as keys);
 * outbound lookups are capped per minute. Throws when a key is unavailable.
 */
export function createPlaidKeyStore(o: KeyStoreOptions) {
  const now = o.now ?? Date.now;
  const max = o.maxEntries ?? 16;
  const ttl = o.ttlMs ?? 24 * 3_600_000;
  const negTtl = o.negativeTtlMs ?? 60_000;
  const perMinute = o.maxLookupsPerMinute ?? 10;
  const keys = new Map<string, { jwk: PlaidJwk; exp: number }>();
  const failed = new Map<string, number>();
  let lookups: number[] = [];

  return async function getKey(kid: string): Promise<PlaidJwk> {
    const t = now();
    const hit = keys.get(kid);
    if (hit && hit.exp > t) return hit.jwk;
    keys.delete(kid);
    const badUntil = failed.get(kid);
    if (badUntil !== undefined && badUntil > t)
      throw new Error("key_unavailable");
    lookups = lookups.filter(x => t - x < 60_000);
    if (lookups.length >= perMinute) throw new Error("lookup_rate_limited");
    lookups.push(t);
    let jwk: PlaidJwk;
    try {
      jwk = await o.fetchKey(kid);
      createPublicKey({ key: jwk, format: "jwk" }); // must be a usable key
    } catch {
      if (failed.size >= max * 4) failed.delete(failed.keys().next().value!);
      failed.set(kid, t + negTtl);
      throw new Error("key_unavailable");
    }
    if (keys.size >= max) keys.delete(keys.keys().next().value!);
    keys.set(kid, { jwk, exp: t + ttl });
    return jwk;
  };
}
