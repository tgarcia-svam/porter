import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL ?? null;
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";

  return NextResponse.json({
    accountUrlConfigured: !!accountUrl,
    accountUrl: accountUrl ?? null,
    containerName,
    containerNameSource: process.env.AZURE_STORAGE_CONTAINER ? "env" : "default",
  });
}
