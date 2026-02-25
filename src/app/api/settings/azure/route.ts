import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type SettingSource = "db" | "env" | "default" | null;

async function getAzureStatus() {
  const settings = await prisma.appSetting.findMany({
    where: {
      key: { in: ["AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_CONTAINER"] },
    },
  });
  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const connInDb = "AZURE_STORAGE_CONNECTION_STRING" in settingsMap;
  const connInEnv = !!process.env.AZURE_STORAGE_CONNECTION_STRING;

  let connectionStringSource: SettingSource = null;
  if (connInDb) connectionStringSource = "db";
  else if (connInEnv) connectionStringSource = "env";

  const containerInDb = "AZURE_STORAGE_CONTAINER" in settingsMap;
  const containerInEnv = !!process.env.AZURE_STORAGE_CONTAINER;

  let containerNameSource: SettingSource = "default";
  if (containerInDb) containerNameSource = "db";
  else if (containerInEnv) containerNameSource = "env";

  const containerName =
    settingsMap["AZURE_STORAGE_CONTAINER"] ??
    process.env.AZURE_STORAGE_CONTAINER ??
    "porter-uploads";

  return {
    connectionStringConfigured: connInDb || connInEnv,
    connectionStringSource,
    containerName,
    containerNameSource,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(await getAzureStatus());
}

const UpdateBody = z.object({
  connectionString: z.string().optional(),
  containerName: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { connectionString, containerName } = parsed.data;

  // Only upsert fields that were provided with a non-empty value
  const upserts: Promise<unknown>[] = [];

  if (connectionString && connectionString.trim() !== "") {
    upserts.push(
      prisma.appSetting.upsert({
        where: { key: "AZURE_STORAGE_CONNECTION_STRING" },
        update: { value: connectionString.trim() },
        create: { key: "AZURE_STORAGE_CONNECTION_STRING", value: connectionString.trim() },
      })
    );
  }

  if (containerName && containerName.trim() !== "") {
    upserts.push(
      prisma.appSetting.upsert({
        where: { key: "AZURE_STORAGE_CONTAINER" },
        update: { value: containerName.trim() },
        create: { key: "AZURE_STORAGE_CONTAINER", value: containerName.trim() },
      })
    );
  }

  await Promise.all(upserts);

  return NextResponse.json(await getAzureStatus());
}
