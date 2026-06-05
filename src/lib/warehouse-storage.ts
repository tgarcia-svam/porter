/**
 * Client for the EXTERNAL data-warehouse landing-zone storage account.
 *
 * Unlike src/lib/azure-storage.ts (which uses the App Service managed identity
 * against Porter's own upload account), this account is owned by the data team
 * in a DIFFERENT Entra tenant and is NOT managed by this application.
 *
 * Auth is secret-less, via cross-tenant workload identity federation:
 *   - Porter holds a user-assigned managed identity (created in bicep,
 *     WAREHOUSE_MI_CLIENT_ID) in its own tenant.
 *   - The data team registers an app (WAREHOUSE_CLIENT_ID in WAREHOUSE_TENANT_ID)
 *     with a federated credential that trusts Porter's managed identity, and
 *     grants that app `Storage Blob Data Contributor` on the target container.
 *   - At runtime we mint a token from the managed identity and present it as a
 *     client assertion for the data-team app (ClientAssertionCredential), which
 *     yields a token valid in the warehouse's tenant. No secret is stored.
 *
 * The container name + root path are admin-editable runtime config and live in
 * AppSetting — see src/lib/warehouse-export-service.ts.
 */

import { ClientAssertionCredential, ManagedIdentityCredential } from "@azure/identity";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

// Standard audience for Entra workload identity federation token exchange.
const TOKEN_EXCHANGE_SCOPE = "api://AzureADTokenExchange/.default";

type WarehouseEnv = {
  accountUrl: string;
  tenantId: string;
  clientId: string;
  /** Client ID of Porter's user-assigned managed identity (the federation subject). */
  miClientId: string;
};

function readWarehouseEnv(): WarehouseEnv | null {
  const accountUrl = process.env.WAREHOUSE_STORAGE_ACCOUNT_URL;
  const tenantId = process.env.WAREHOUSE_TENANT_ID;
  const clientId = process.env.WAREHOUSE_CLIENT_ID;
  const miClientId = process.env.WAREHOUSE_MI_CLIENT_ID;
  if (!accountUrl || !tenantId || !clientId || !miClientId) return null;
  return { accountUrl, tenantId, clientId, miClientId };
}

/**
 * True when the warehouse connection env vars are present, i.e. this deployment
 * is wired up to talk to a warehouse account. The admin UI surfaces this so
 * operators know whether the integration is configured.
 */
export function isWarehouseConfigured(): boolean {
  return readWarehouseEnv() !== null;
}

function getWarehouseContainerClient(containerName: string): ContainerClient {
  const env = readWarehouseEnv();
  if (!env) {
    throw new Error("Warehouse export credentials are not configured");
  }
  // Mint the managed-identity token on demand and hand it to the data-team app
  // as a federated client assertion (cross-tenant, secret-less).
  const miCredential = new ManagedIdentityCredential({ clientId: env.miClientId });
  const credential = new ClientAssertionCredential(env.tenantId, env.clientId, async () => {
    const token = await miCredential.getToken(TOKEN_EXCHANGE_SCOPE);
    if (!token) throw new Error("Failed to acquire managed-identity assertion for warehouse export");
    return token.token;
  });
  const blobServiceClient = new BlobServiceClient(env.accountUrl, credential);
  return blobServiceClient.getContainerClient(containerName);
}

/**
 * Upload a Parquet buffer to the warehouse container, overwriting any existing
 * blob at the same name (uploads are keyed by uploadId, so a redelivery just
 * overwrites — idempotent). Returns the blob URL.
 */
export async function uploadParquetToWarehouse(
  containerName: string,
  blobName: string,
  buffer: Buffer
): Promise<string> {
  const containerClient = getWarehouseContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: "application/vnd.apache.parquet" },
  });
  return blockBlobClient.url;
}
