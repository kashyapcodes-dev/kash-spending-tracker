import {
  createPlaidKeyStore,
  verifyPlaidWebhook,
  type PlaidJwk,
} from "@kash/integrations";
import { clientIp } from "@kash/core";
import { getContainer } from "@/server/container";

/** Optional Plaid webhook. Off (404) unless PLAID_WEBHOOKS=true; signature-verified; enqueue only. */
const MAX_BODY = 64 * 1024;
let store: ReturnType<typeof createPlaidKeyStore> | undefined;

const reject = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/** Read at most MAX_BODY bytes; null when the body is larger. */
async function readBounded(request: Request): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(request: Request): Promise<Response> {
  const { config, services, limiter, trustedProxy } = getContainer();
  if (!config.PLAID_WEBHOOKS)
    return Response.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  // Public and pre-authentication: limited per client IP before any work is done.
  const hit = limiter.hit(
    `plaid-webhook:ip:${clientIp(request.headers, trustedProxy)}`,
    60,
  );
  if (!hit.ok)
    return Response.json(
      { error: { code: "rate_limited", message: "Too many requests" } },
      {
        status: 429,
        headers: { "retry-after": String(hit.retryAfterSeconds) },
      },
    );
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type))
    return reject(415, "unsupported_media_type", "Expected application/json");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY)
    return reject(413, "payload_too_large", "Body too large");
  const bytes = await readBounded(request);
  if (!bytes) return reject(413, "payload_too_large", "Body too large");
  const raw = Buffer.from(bytes).toString("utf8");
  store ??= createPlaidKeyStore({
    fetchKey: async kid => {
      const host =
        config.PLAID_ENV === "production" ? "production" : config.PLAID_ENV;
      const res = await fetch(
        `https://${host}.plaid.com/webhook_verification_key/get`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: config.PLAID_CLIENT_ID,
            secret: config.PLAID_SECRET,
            key_id: kid,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) throw new Error("key_unavailable");
      return ((await res.json()) as { key: PlaidJwk }).key;
    },
  });
  const ok = await verifyPlaidWebhook({
    token: request.headers.get("plaid-verification"),
    rawBody: raw,
    getKey: store,
  });
  if (!ok)
    return Response.json(
      { error: { code: "unauthenticated", message: "Invalid signature" } },
      { status: 401 },
    );
  const body = JSON.parse(raw) as {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
  };
  if (
    body.webhook_type === "TRANSACTIONS" &&
    body.webhook_code === "SYNC_UPDATES_AVAILABLE" &&
    body.item_id
  ) {
    const ids = await services.connections.idsByExternalId(
      "plaid",
      body.item_id,
    );
    const { enqueueSync } = await import("@/server/queue");
    for (const id of ids) await enqueueSync(config, id);
  }
  return Response.json({ ok: true });
}
