import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, SASProtocol, type UserDelegationKey } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

// All blob operations (read, write, create, delete) authenticate with the App
// Service managed identity, which holds "Storage Blob Data Contributor" — that
// role includes delete, so no storage account key is needed anywhere.
function getContainerClient() {
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";

  if (!accountUrl) {
    throw new Error("AZURE_STORAGE_ACCOUNT_URL environment variable is not set");
  }

  const blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  return blobServiceClient.getContainerClient(containerName);
}

/**
 * When true, uploads whose Defender malware scan has not completed within the
 * polling window must be HELD rather than allowed through (fail-closed). Off by
 * default so environments without Defender for Storage enabled (where the scan
 * tag never appears) don't stall every upload. Enable in production once
 * Defender for Storage malware scanning is confirmed enabled on the account.
 */
export function isMalwareScanFailClosed(): boolean {
  return process.env.MALWARE_SCAN_FAIL_CLOSED === "true";
}

export async function waitForMalwareScanResult(
  blobName: string,
  // Defender for Storage scans typically finish in seconds but can take longer
  // for bigger files; default 60s (overridable) instead of the old 8s so the
  // common case resolves to a definitive clean/malicious rather than pending.
  timeoutMs = Number(process.env.MALWARE_SCAN_TIMEOUT_MS) || 60_000,
  pollIntervalMs = 2_000
): Promise<"clean" | "malicious" | "pending"> {
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { tags } = await blockBlobClient.getTags();
    // Defender writes a blob index tag with the verdict. The exact key has
    // varied across Defender versions (currently "Malware Scanning scan
    // result"), so match by pattern rather than a brittle exact string —
    // a mismatch here silently reads as "pending" forever under fail-closed.
    const result = Object.entries(tags).find(([k]) =>
      /malware scanning.*result/i.test(k)
    )?.[1];
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
  // Decode first so the SDK doesn't double-encode any percent-encoded characters.
  const url = new URL(blobUrl);
  const blobName = decodeURIComponent(
    url.pathname.replace(`/${containerClient.containerName}/`, "")
  );

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  return await blockBlobClient.downloadToBuffer();
}

export async function downloadBlobByName(blobName: string): Promise<Buffer> {
  const containerClient = getContainerClient();
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

// ── User delegation SAS ──────────────────────────────────────────────────────
// Upload SAS tokens are signed with a *user delegation key* obtained via the
// managed identity (DefaultAzureCredential) — NOT the storage account key. This
// removes the account-key dependency for SAS issuance: a compromised app can
// only mint SAS within the identity's RBAC scope, and the delegation key
// auto-expires (max 7 days). Requires the identity to hold "Storage Blob
// Delegator" (to mint the key) plus a data role like "Storage Blob Data
// Contributor" (for the granted ops) — both assigned in bicep/main.bicep.

// A delegation key can sign many SAS tokens, so cache it process-wide and
// refresh before it gets close to expiry rather than minting one per upload.
let cachedDelegationKey: { key: UserDelegationKey; expiresOn: number } | null = null;
const DELEGATION_KEY_TTL_MS = 60 * 60 * 1000;            // mint keys valid 1 hour
const DELEGATION_KEY_MIN_REMAINING_MS = 20 * 60 * 1000;  // refresh with <20 min left

async function getDelegationKey(client: BlobServiceClient): Promise<UserDelegationKey> {
  const now = Date.now();
  if (cachedDelegationKey && cachedDelegationKey.expiresOn - now > DELEGATION_KEY_MIN_REMAINING_MS) {
    return cachedDelegationKey.key;
  }
  // Start 5 min in the past to tolerate clock skew between the app and storage.
  const startsOn = new Date(now - 5 * 60 * 1000);
  const expiresOn = new Date(now + DELEGATION_KEY_TTL_MS);
  const key = await client.getUserDelegationKey(startsOn, expiresOn);
  cachedDelegationKey = { key, expiresOn: expiresOn.getTime() };
  return key;
}

/**
 * Generates a short-lived, write-only SAS URL so the browser can upload
 * directly to blob storage without routing the file through the app server.
 * Signed with a user delegation key (managed identity) — no storage account key.
 */
export async function generateUploadSasUrl(blobName: string): Promise<string> {
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";

  if (!accountUrl) throw new Error("AZURE_STORAGE_ACCOUNT_URL is not set");
  // Derive account name from the URL when not set explicitly
  // e.g. https://myaccount.blob.core.windows.net → "myaccount"
  const accountName =
    process.env.AZURE_STORAGE_ACCOUNT_NAME ?? new URL(accountUrl).hostname.split(".")[0];

  const blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  const userDelegationKey = await getDelegationKey(blobServiceClient);

  const startsOn = new Date(Date.now() - 5 * 60 * 1000);   // clock-skew tolerance
  const expiresOn = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  const sasQuery = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("cw"), // create + write only
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    userDelegationKey,
    accountName
  );

  return `${accountUrl.replace(/\/$/, "")}/${containerName}/${blobName}?${sasQuery.toString()}`;
}

/**
 * Generates a short-lived, read-only SAS URL for downloading a resource blob.
 * Signed with a user delegation key (managed identity) — no storage account key.
 */
export async function generateDownloadSasUrl(
  blobName: string,
  contentDisposition?: string
): Promise<string> {
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "porter-uploads";

  if (!accountUrl) throw new Error("AZURE_STORAGE_ACCOUNT_URL is not set");
  const accountName =
    process.env.AZURE_STORAGE_ACCOUNT_NAME ?? new URL(accountUrl).hostname.split(".")[0];

  const blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  const userDelegationKey = await getDelegationKey(blobServiceClient);

  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const sasQuery = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
      ...(contentDisposition ? { contentDisposition } : {}),
    },
    userDelegationKey,
    accountName
  );

  return `${accountUrl.replace(/\/$/, "")}/${containerName}/${blobName}?${sasQuery.toString()}`;
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
