import { toNextJsHandler } from "better-auth/next-js";
import { CLIENT_IP_HEADER, clientIp } from "@kash/core";
import { getContainer } from "@/server/container";

// Better Auth's own routes. Not part of the versioned /api/v1 contract.
export const dynamic = "force-dynamic";

/**
 * Replace every client-supplied identity header with the IP we computed, so Better Auth's
 * rate limiter keys on the same address as /api/v1 and cannot be reset by spoofing.
 */
function withClientIp(request: Request, ip: string): Request {
  const headers = new Headers(request.headers);
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.set(CLIENT_IP_HEADER, ip);
  return new Request(request, { headers });
}

const handler = (method: "GET" | "POST") => (request: Request) => {
  const c = getContainer();
  return toNextJsHandler(c.auth)[method](
    withClientIp(request, clientIp(request.headers, c.trustedProxy)),
  );
};
export const GET = handler("GET");
export const POST = handler("POST");
