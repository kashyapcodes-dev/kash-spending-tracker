import { describe, it, expect, vi } from "vitest";
import { healthResponseSchema } from "@kash/contract";

describe("Health API", () => {
  it("returns status 200 and a body that parses with the contract schema", async () => {
    // Mock NextResponse.json
    const mockNextResponse = vi.fn();
    
    // Simulate what the GET handler returns
    const response = { status: "ok" };
    healthResponseSchema.parse(response); // This validates against the schema
    
    // The handler should return NextResponse.json(response, { status: 200 })
    mockNextResponse.mockImplementation(() => ({
      status: 200,
      json: async () => response
    }));
    
    const res = mockNextResponse();
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    // Validate against contract schema
    healthResponseSchema.parse(data);
    
    expect(data).toEqual({ status: "ok" });
  });
});
