import { AppError } from "@kash/core";

export const JSON_LIMIT = 1024 * 1024;
export const CSV_LIMIT = 5 * 1024 * 1024 + 64 * 1024; // 5 MB file plus multipart overhead

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF (M9 scope 6b). A state-changing request must not come from another origin.
 * Requests carrying a session cookie must also prove they are same-origin: an `Origin` that
 * matches, or no `Origin` with `Sec-Fetch-Site: same-origin` (or `none`). `same-site`
 * (a sibling subdomain) is refused. Bearer-token requests carry no ambient credentials,
 * so only the cross-site checks apply to them.
 */
export function csrfRejected(
  request: Request,
  appUrl: string,
  hasBearer: boolean,
): boolean {
  if (SAFE.has(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (site === "cross-site") return true;
  if (origin) {
    const allowed = new Set([
      new URL(appUrl).origin,
      new URL(request.url).origin,
    ]);
    return !allowed.has(origin);
  }
  // No cookie means no ambient credential to abuse; the request will fail authentication anyway.
  if (hasBearer || !request.headers.get("cookie")) return false;
  return !(site === "same-origin" || site === "none");
}

/**
 * Read a body into memory without trusting Content-Length: count bytes as they arrive and
 * stop at the cap. Throws 413 `payload_too_large`.
 */
export async function readBounded(
  request: Request,
  max: number,
): Promise<Uint8Array> {
  const tooLarge = () =>
    new AppError("payload_too_large", "Request body is too large");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
