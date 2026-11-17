import { describe, expect, it } from "vitest";
import { buildCsp, isNoStorePath, securityHeaders } from "./security-headers";

describe("M9-API-1 / M9-API-2 security headers", () => {
  it("CSP has the nonce, frame-ancestors none, no unsafe-inline/eval in script-src", () => {
    const csp = buildCsp("abc123");
    const script = csp.split("; ").find(d => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
    for (const d of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "connect-src 'self'",
      "default-src 'self'",
    ])
      expect(csp).toContain(d);
  });

  it("nonces differ per call site input; dev only adds unsafe-eval", () => {
    expect(buildCsp("a")).not.toBe(buildCsp("b"));
    expect(buildCsp("a", true)).toContain("'unsafe-eval'");
    expect(buildCsp("a", false)).not.toContain("'unsafe-eval'");
  });

  it("HSTS only for https", () => {
    expect(securityHeaders("http://localhost:3000")).not.toHaveProperty(
      "Strict-Transport-Security",
    );
    expect(securityHeaders("https://kash.example")).toHaveProperty(
      "Strict-Transport-Security",
    );
    const h = securityHeaders("http://x");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\).*geolocation=\(\)/);
  });

  it("no-store covers /api/v1 and /api/auth only", () => {
    expect(isNoStorePath("/api/v1/me")).toBe(true);
    expect(isNoStorePath("/api/auth/sign-in/email")).toBe(true);
    expect(isNoStorePath("/app")).toBe(false);
    expect(isNoStorePath("/api/v10")).toBe(false);
  });
});
