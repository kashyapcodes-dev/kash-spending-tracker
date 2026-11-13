import { describe, it, expect } from "vitest";
import { coreVersion } from "./index";

describe("@kash/core", () => {
  it("should export a core version constant", () => {
    expect(coreVersion).toBe("0.0.1");
  });
});
