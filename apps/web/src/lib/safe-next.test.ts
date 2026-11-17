import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("M9-U-13 / M9-U-20 safeNext", () => {
  it.each([
    "//evil.com",
    "/\\evil.com",
    "/%5cevil.com/\\x",
    "/\tevil.com",
    "/\t/evil.com",
    "/\r/evil.com",
    "/\n/evil.com",
    "/a\nb",
    "/a\u0000b",
    "/a\u007fb",
    "https://evil.com",
    "javascript:alert(1)",
    "",
    undefined,
  ])("rejects %j", bad => {
    expect(safeNext(bad)).toBe("/app");
  });

  it("accepts same-site paths", () => {
    expect(safeNext("/b/abc/expenses?x=1")).toBe("/b/abc/expenses?x=1");
    expect(safeNext("/invite/tok")).toBe("/invite/tok");
  });
});
