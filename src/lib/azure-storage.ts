import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";

let _containerClient: ContainerClient | null = null;

function getContainerClient(): ContainerClient {
  if (_containerClient) return _containerClient;

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName =
    process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";

  if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  }

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  _containerClient = blobServiceClient.getContainerClient(containerName);
  return _containerClient;
}

export async function uploadToBlob(
  buffer: Buffer,
  blobName: string,
  contentType: string
): Promise<string> {
  const containerClient = getContainerClient();

  // Ensure container exists
  await containerClient.createIfNotExists({ access: "blob" });

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return blockBlobClient.url;
}
