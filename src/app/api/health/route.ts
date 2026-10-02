import { NextResponse } from "next/server";
import { prismaAdmin } from "@/lib/prisma-admin";

/**
 * Liveness/readiness probe used by:
 *  - Azure App Service (configure as health check path in Azure Portal / Bicep)
 *  - The deploy workflow warm-up step, which polls this until 200 before
 *    declaring the deployment done — so the first real user never hits a cold app
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prismaAdmin.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json(
      { ok: false, error: "database unavailable" },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, ts: Date.now() });
}
