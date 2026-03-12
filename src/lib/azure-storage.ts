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

export async function waitForMalwareScanResult(
  blobName: string,
  timeoutMs = 30_000,
  pollIntervalMs = 2_000
): Promise<"clean" | "malicious" | "pending"> {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { tags } = await blockBlobClient.getTags();
    const result = tags["Malware Scanning.scan results"];
    if (result === "No threats found") return "clean";
    if (result === "Malicious") return "malicious";
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
  }
  return "pending";
}

export async function deleteBlobByName(blobName: string): Promise<void> {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
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
