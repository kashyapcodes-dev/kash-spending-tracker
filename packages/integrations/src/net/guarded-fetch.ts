import { lookup } from "node:dns/promises";
import https from "node:https";
import { isBlockedAddress } from "./ip";

export class GuardError extends Error {
  constructor(
    readonly code:
      | "bad_url"
      | "host_not_allowed"
      | "blocked_address"
      | "timeout"
      | "too_large"
      | "redirect"
      | "network",
  ) {
    super(code);
    this.name = "GuardError";
  }
}

export interface GuardedFetchOptions {
  /** Lower-case host names that may be contacted. */
  allowedHosts: readonly string[];
  /** Allow userinfo in the URL (SimpleFIN access URLs). It is moved to an Authorization header. */
  allowUserinfo?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  /** Test seam: resolve a host name to addresses. */
  resolve?: (host: string) => Promise<string[]>;
  /** Test seam: perform the request against an already-checked address. */
  transport?: (req: TransportRequest) => Promise<TransportResponse>;
}

export interface TransportRequest {
  url: URL;
  address: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  timeoutMs: number;
  maxBytes: number;
}
export interface TransportResponse {
  status: number;
  body: Buffer;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Validate scheme, userinfo, port and host allowlist. Does not touch the network. */
export function checkUrl(
  raw: string,
  allowedHosts: readonly string[],
  allowUserinfo = false,
): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new GuardError("bad_url");
  }
  if (u.protocol !== "https:") throw new GuardError("bad_url");
  if (!allowUserinfo && (u.username || u.password))
    throw new GuardError("bad_url");
  if (u.port !== "") throw new GuardError("bad_url"); // default port only
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.map(h => h.toLowerCase()).includes(host))
    throw new GuardError("host_not_allowed");
  return u;
}

async function defaultResolve(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map(r => r.address);
}

function nodeTransport(r: TransportRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        // Connect to the address we checked. The Host header and TLS server name
        // still carry the host name, so there is no second resolution.
        host: r.address,
        port: 443,
        method: r.method,
        path: `${r.url.pathname}${r.url.search}`,
        servername: r.url.hostname,
        headers: { ...r.headers, host: r.url.hostname },
        timeout: r.timeoutMs,
      },
      res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > r.maxBytes) {
            req.destroy(new GuardError("too_large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new GuardError("timeout")));
    req.on("error", reject);
    if (r.body) req.write(r.body);
    req.end();
  });
}

/**
 * The only way the server may call a URL derived from user input. Callers get a
 * standard Response; redirects are never followed (a 3xx is an error).
 */
export function createGuardedFetch(o: GuardedFetchOptions): typeof fetch {
  const resolve = o.resolve ?? defaultResolve;
  const transport = o.transport ?? nodeTransport;
  return async (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = checkUrl(raw, o.allowedHosts, o.allowUserinfo);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    if (url.username || url.password) {
      const cred = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
      headers["authorization"] =
        `Basic ${Buffer.from(cred).toString("base64")}`;
      url.username = "";
      url.password = "";
    }
    let addresses: string[];
    try {
      addresses = await resolve(url.hostname);
    } catch {
      throw new GuardError("network");
    }
    // Every returned address must be public: a mixed answer is a rebinding signal.
    if (addresses.length === 0 || addresses.some(isBlockedAddress))
      throw new GuardError("blocked_address");
    let res: TransportResponse;
    try {
      res = await transport({
        url,
        address: addresses[0]!,
        method: init?.method ?? "GET",
        headers,
        body: typeof init?.body === "string" ? init.body : undefined,
        timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: o.maxBytes ?? DEFAULT_MAX_BYTES,
      });
    } catch (e) {
      if (e instanceof GuardError) throw e;
      throw new GuardError("network");
    }
    if (res.status >= 300 && res.status < 400) throw new GuardError("redirect");
    return new Response(res.status === 204 ? null : new Uint8Array(res.body), {
      status: res.status,
    });
  };
}
