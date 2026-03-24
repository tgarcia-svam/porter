import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL ?? null;
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";

  return NextResponse.json({
    accountUrlConfigured: !!accountUrl,
    accountUrl: accountUrl ?? null,
    containerName,
    containerNameSource: process.env.AZURE_STORAGE_CONTAINER ? "env" : "default",
  });
}
