import { describe, it, expect } from "vitest";
import { healthResponseSchema } from "./index";

describe("healthResponseSchema", () => {
  it("parses valid response with status 'ok'", () => {
    const validData = { status: "ok" };
    const result = healthResponseSchema.parse(validData);
    expect(result).toEqual({ status: "ok" });
  });

  it("rejects invalid response with status 1", () => {
    const invalidData = { status: 1 };
    expect(() => healthResponseSchema.parse(invalidData)).toThrow();
  });
});
