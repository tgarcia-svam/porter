import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

function getContainerClient() {
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";

  if (!accountUrl) {
    throw new Error("AZURE_STORAGE_ACCOUNT_URL environment variable is not set");
  }

  const blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  return blobServiceClient.getContainerClient(containerName);
}

export async function waitForMalwareScanResult(
  blobName: string,
  timeoutMs = 30_000,
  pollIntervalMs = 2_000
): Promise<"clean" | "malicious" | "pending"> {
  const containerClient = getContainerClient();
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
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

export async function downloadFromBlob(blobUrl: string): Promise<Buffer> {
  const containerClient = getContainerClient();

  // Extract blob name from URL: strip scheme + host + "/{containerName}/"
  const url = new URL(blobUrl);
  const blobName = url.pathname.replace(
    `/${containerClient.containerName}/`,
    ""
  );

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  return await blockBlobClient.downloadToBuffer();
}

async function logAzurePrincipal() {
  try {
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken("https://storage.azure.com/.default");
    if (token) {
      const payload = JSON.parse(
        Buffer.from(token.token.split(".")[1], "base64url").toString()
      );
      console.log("[azure-storage] principal oid:", payload.oid ?? payload.sub ?? "unknown");
    }
  } catch (err) {
    console.warn("[azure-storage] could not resolve principal:", err);
  }
}

export async function uploadToBlob(
  buffer: Buffer,
  blobName: string,
  contentType: string
): Promise<string> {
  await logAzurePrincipal();
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return blockBlobClient.url;
}
