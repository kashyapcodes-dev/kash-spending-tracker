import { describe, expect, it } from "vitest";
import { clientIp, parseTrustedProxy } from "./client-ip";

const h = (o: Record<string, string>) => ({
  get: (k: string) => o[k.toLowerCase()] ?? null,
});

describe("M9-U-5 client IP", () => {
  it("none: forwarding headers never change the key", () => {
    const t = parseTrustedProxy("none");
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), t)).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9" }), t)).toBe("unknown");
    expect(clientIp(h({ "x-real-ip": "9.9.9.9" }), t)).toBe("unknown");
  });

  it("default setting is none", () => {
    expect(
      clientIp(
        h({ "x-forwarded-for": "1.2.3.4" }),
        parseTrustedProxy(undefined),
      ),
    ).toBe("unknown");
  });

  it("trusted proxy: right-most untrusted entry wins; spoofed left entries are ignored", () => {
    const t = parseTrustedProxy("loopback");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), t)).toBe(
      "203.0.113.9",
    );
    expect(clientIp(h({ "x-forwarded-for": "7.7.7.7, 203.0.113.9" }), t)).toBe(
      "203.0.113.9",
    );
    expect(
      clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 127.0.0.1" }), t),
    ).toBe("203.0.113.9");
  });

  it("CIDR lists, including IPv6", () => {
    const t = parseTrustedProxy("10.0.0.0/8, fd00::/8");
    expect(
      clientIp(h({ "x-forwarded-for": "198.51.100.7, 10.1.1.1" }), t),
    ).toBe("198.51.100.7");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::5, fd00::1" }), t)).toBe(
      "2001:db8::5",
    );
  });

  it("garbage or all-trusted chains give unknown", () => {
    const t = parseTrustedProxy("loopback");
    expect(clientIp(h({ "x-forwarded-for": "not-an-ip" }), t)).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "127.0.0.1" }), t)).toBe("unknown");
    expect(clientIp(h({}), t)).toBe("unknown");
  });

  it("rejects bad settings", () => {
    expect(() => parseTrustedProxy("banana")).toThrow();
    expect(() => parseTrustedProxy("10.0.0.0/99")).toThrow();
  });
});
