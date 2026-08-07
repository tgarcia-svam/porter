import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

// Called by the porter-platform admin portal to aggregate stats for this instance.
// Protected by a shared secret set at provisioning time.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-platform-secret");
  if (!secret || secret !== process.env.PLATFORM_STATS_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [userCount, uploadCount] = await Promise.all([
    prisma.user.count({ where: { role: "UPLOADER" } }),
    prisma.fileUpload.count({ where: { deletedAt: null } }),
  ]);

  // Estimate storage by summing blob sizes in the uploads container
  let storageMb = 0;
  try {
    const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
    const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";
    if (accountUrl) {
      const blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
      const containerClient = blobServiceClient.getContainerClient(containerName);
      let totalBytes = 0;
      for await (const blob of containerClient.listBlobsFlat()) {
        totalBytes += blob.properties.contentLength ?? 0;
      }
      storageMb = Math.round(totalBytes / (1024 * 1024));
    }
  } catch {
    // Non-fatal — stats endpoint returns 0 if storage listing fails
  }

  return NextResponse.json({ userCount, uploadCount, storageMb });
}
