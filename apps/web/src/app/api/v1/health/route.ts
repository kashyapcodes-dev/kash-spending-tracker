import { NextResponse } from "next/server";
import { healthResponseSchema } from "@kash/contract";

export function GET() {
  const response = { status: "ok" };

  // Validate response against contract schema
  healthResponseSchema.parse(response);

  return NextResponse.json(response, { status: 200 });
}
