import "server-only";
import { NextResponse } from "next/server";
import { ContourError, type ContourErrorCode } from "@/sdk/types";

const STATUS: Record<ContourErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_REVISION: 409,
  EXPIRED_PROPOSAL: 410,
  INCOMPATIBLE_MANIFEST: 409,
  INCOMPATIBLE_SNAPSHOT: 409,
  INVALID_CONFIG: 422,
  PROPOSAL_NOT_READY: 409,
  HASH_MISMATCH: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYMENT_REQUIRED: 402,
  AGENT_ACCESS_DISABLED: 403,
  INTERNAL: 500,
};

export function toContourError(err: unknown): ContourError {
  if (err instanceof ContourError) return err;
  console.error("[contour] unexpected error", err instanceof Error ? err.message : "unknown");
  return new ContourError("INTERNAL", "Internal error");
}

export function errorResponse(err: unknown) {
  const e = toContourError(err);
  return NextResponse.json({ error: e.toJSON() }, { status: STATUS[e.code] ?? 500 });
}

export function statusFor(code: ContourErrorCode) {
  return STATUS[code] ?? 500;
}
