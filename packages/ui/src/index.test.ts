import { describe, it, expect } from "vitest";
import { uiVersion } from "./index";

describe("@kash/ui", () => {
  it("should export a UI version constant", () => {
    expect(uiVersion).toBe("0.0.1");
  });
});
