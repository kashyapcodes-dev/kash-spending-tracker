import { describe, it, expect } from "vitest";
import { dbVersion } from "./index";

describe("@kash/db", () => {
  it("should export a db version constant", () => {
    expect(dbVersion).toBe("0.0.1");
  });
});
