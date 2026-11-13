import { describe, it, expect } from "vitest";
import { apiClientVersion } from "./index";

describe("@kash/api-client", () => {
  it("should export an api client version constant", () => {
    expect(apiClientVersion).toBe("0.0.1");
  });
});
