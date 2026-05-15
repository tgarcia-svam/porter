import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

// ── Response helpers ──────────────────────────────────────────────────────────

export const apiUnauthorized = (msg = "Unauthorized") =>
  NextResponse.json({ error: msg }, { status: 401 });

export const apiForbidden = (msg = "Forbidden") =>
  NextResponse.json({ error: msg }, { status: 403 });

export const apiNotFound = (msg = "Not found") =>
  NextResponse.json({ error: msg }, { status: 404 });

export const apiBadRequest = (msg: string | object) =>
  NextResponse.json({ error: msg }, { status: 400 });

export const apiConflict = (msg: string) =>
  NextResponse.json({ error: msg }, { status: 409 });

export const apiPayloadTooLarge = (msg: string) =>
  NextResponse.json({ error: msg }, { status: 413 });

export const apiUnsupportedMediaType = (msg: string) =>
  NextResponse.json({ error: msg }, { status: 415 });

export const apiUnprocessable = (msg: string) =>
  NextResponse.json({ error: msg }, { status: 422 });

export const apiInternalError = (msg = "Internal server error") =>
  NextResponse.json({ error: msg }, { status: 500 });

export const apiBadGateway = (msg: string) =>
  NextResponse.json({ error: msg }, { status: 502 });

export const apiServiceUnavailable = (msg: string) =>
  NextResponse.json({ error: msg }, { status: 503 });

// ── withHandler ───────────────────────────────────────────────────────────────
// Wraps a route handler to catch unhandled Prisma errors and unexpected throws.
// P2025 (record not found) → 404. All other unhandled errors → 500.
// Inner try/catch blocks for domain-specific errors (e.g. P2002 conflict with a
// custom message) should re-throw unknown errors so this wrapper catches them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withHandler<Ctx = any>(
  fn: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") return apiNotFound();
        console.error("[api] prisma error:", err.code, err.message);
        return apiInternalError();
      }
      console.error("[api] unhandled error:", err);
      return apiInternalError();
    }
  };
}
