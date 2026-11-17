import { describe, expect, it } from "vitest";
import { isExpired, signalsSignedOut } from "./cache-policy";

describe("M9-U-17 service worker cache policy", () => {
  const now = Date.now();
  it("a cached response older than 24 h is not served", () => {
    expect(isExpired(String(now - 23 * 3_600_000), now)).toBe(false);
    expect(isExpired(String(now - 25 * 3_600_000), now)).toBe(true);
  });
  it("an unstamped or garbled copy is treated as expired", () => {
    expect(isExpired(null, now)).toBe(true);
    expect(isExpired("abc", now)).toBe(true);
  });
  it("a 401 or a redirect to sign-in means the session is gone", () => {
    expect(
      signalsSignedOut({
        status: 401,
        redirected: false,
        url: "http://x/api/v1/me",
      }),
    ).toBe(true);
    expect(
      signalsSignedOut({
        status: 200,
        redirected: true,
        url: "http://x/sign-in",
      }),
    ).toBe(true);
    expect(
      signalsSignedOut({ status: 200, redirected: true, url: "http://x/app" }),
    ).toBe(false);
    expect(
      signalsSignedOut({ status: 200, redirected: false, url: "http://x/app" }),
    ).toBe(false);
  });
});
