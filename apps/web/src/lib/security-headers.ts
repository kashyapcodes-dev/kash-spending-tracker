/** Security headers (M9 scope 4). Pure so they can be tested without a server. */

export function buildCsp(nonce: string, dev = false): string {
  const script = [
    `'self'`,
    `'nonce-${nonce}'`,
    ...(dev ? [`'unsafe-eval'`] : []),
  ];
  return [
    `default-src 'self'`,
    `script-src ${script.join(" ")}`,
    // React inline styles and recharts need this; scripts are the XSS vector that matters (ADR-0013).
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
  ].join("; ");
}

export function securityHeaders(appUrl: string): Record<string, string> {
  const h: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Quick-add needs none of these today; keep them off.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (appUrl.startsWith("https://"))
    h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return h;
}

/** API and auth responses are never cached by the browser or a shared cache. */
export const isNoStorePath = (pathname: string) =>
  pathname.startsWith("/api/v1/") ||
  pathname === "/api/v1" ||
  pathname.startsWith("/api/auth/") ||
  pathname === "/api/auth";
