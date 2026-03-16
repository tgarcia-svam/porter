import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type SettingSource = "db" | "env" | "default" | null;

async function getAzureStatus() {
  const settings = await prisma.appSetting.findMany({
    where: {
      key: { in: ["AZURE_STORAGE_ACCOUNT_URL", "AZURE_STORAGE_CONTAINER"] },
    },
  });
  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const urlInDb = "AZURE_STORAGE_ACCOUNT_URL" in settingsMap;
  const urlInEnv = !!process.env.AZURE_STORAGE_ACCOUNT_URL;

  let accountUrlSource: SettingSource = null;
  if (urlInDb) accountUrlSource = "db";
  else if (urlInEnv) accountUrlSource = "env";

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
    accountUrlConfigured: urlInDb || urlInEnv,
    accountUrlSource,
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
  accountUrl: z.string().optional(),
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

  const { accountUrl, containerName } = parsed.data;

  const upserts: Promise<unknown>[] = [];

  if (accountUrl && accountUrl.trim() !== "") {
    upserts.push(
      prisma.appSetting.upsert({
        where: { key: "AZURE_STORAGE_ACCOUNT_URL" },
        update: { value: accountUrl.trim() },
        create: { key: "AZURE_STORAGE_ACCOUNT_URL", value: accountUrl.trim() },
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
