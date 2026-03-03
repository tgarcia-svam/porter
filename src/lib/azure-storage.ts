import { BlobServiceClient } from "@azure/storage-blob";
import { prisma } from "@/lib/prisma";

async function getContainerClient() {
  const settings = await prisma.appSetting.findMany({
    where: {
      key: { in: ["AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_CONTAINER"] },
    },
  });

  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const connectionString =
    settingsMap["AZURE_STORAGE_CONNECTION_STRING"] ??
    process.env.AZURE_STORAGE_CONNECTION_STRING;

  const containerName =
    settingsMap["AZURE_STORAGE_CONTAINER"] ??
    process.env.AZURE_STORAGE_CONTAINER ??
    "porter-uploads";

  if (!connectionString) {
    throw new Error("Azure Storage connection string is not configured");
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(containerName);
}

export async function downloadFromBlob(blobUrl: string): Promise<Buffer> {
  const containerClient = await getContainerClient();

  // Extract blob name from URL: strip scheme + host + "/{containerName}/"
  const url = new URL(blobUrl);
  const blobName = url.pathname.replace(
    `/${containerClient.containerName}/`,
    ""
  );

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  return await blockBlobClient.downloadToBuffer();
}

export async function uploadToBlob(
  buffer: Buffer,
  blobName: string,
  contentType: string
): Promise<string> {
  const containerClient = await getContainerClient();

  // Ensure container exists
  await containerClient.createIfNotExists({ access: "blob" });

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return blockBlobClient.url;
}
