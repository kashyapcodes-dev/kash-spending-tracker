import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  buildCsp,
  isNoStorePath,
  securityHeaders,
} from "@/lib/security-headers";

const PROTECTED = /^\/(b\/|app$)/;

/**
 * Every response gets the security headers; HTML responses also get a per-request CSP
 * nonce. The session check here is an optimistic redirect only: the real check happens in
 * each page and route handler.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  let response: NextResponse;
  if (PROTECTED.test(pathname) && !getSessionCookie(request)) {
    response = NextResponse.redirect(new URL("/sign-in", request.url));
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.next();
  } else {
    const nonce = btoa(crypto.randomUUID());
    const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
    const headers = new Headers(request.headers);
    // Next reads the nonce from the request's CSP and applies it to its own scripts.
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    response = NextResponse.next({ request: { headers } });
    response.headers.set("Content-Security-Policy", csp);
  }
  for (const [k, v] of Object.entries(securityHeaders(appUrl)))
    response.headers.set(k, v);
  if (isNoStorePath(pathname))
    response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  // Everything except static assets; the service worker and manifest keep their own headers.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons/|manifest.webmanifest).*)",
  ],
};
