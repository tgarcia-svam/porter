/**
 * Client for the EXTERNAL data-warehouse landing-zone storage account.
 *
 * Unlike src/lib/azure-storage.ts (which uses the App Service managed identity
 * against Porter's own upload account), this account is owned by the data team
 * in a DIFFERENT Entra tenant and is NOT managed by this application.
 *
 * Auth is secret-less, via cross-tenant workload identity federation:
 *   - Porter holds a user-assigned managed identity (created in bicep,
 *     WAREHOUSE_MI_CLIENT_ID) in its own tenant. This is the ONLY warehouse
 *     value that comes from the environment — it's infrastructure, not a
 *     setting an operator types.
 *   - The data team registers an app (clientId in tenantId) with a federated
 *     credential that trusts Porter's managed identity, and grants that app
 *     `Storage Blob Data Contributor` on the target container.
 *   - At runtime we mint a token from the managed identity and present it as a
 *     client assertion for the data-team app (ClientAssertionCredential), which
 *     yields a token valid in the warehouse's tenant. No secret is stored.
 *
 * The destination (account URL, tenant, client ID, container, root path) is
 * admin-editable runtime config and lives in AppSetting — see
 * src/lib/warehouse-export-service.ts.
 */

import { ClientAssertionCredential, ManagedIdentityCredential } from "@azure/identity";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

// Standard audience for Entra workload identity federation token exchange.
const TOKEN_EXCHANGE_SCOPE = "api://AzureADTokenExchange/.default";

/** Connection coordinates for the data-team's federated app + account. */
export type WarehouseConnection = {
  accountUrl: string;
  tenantId: string;
  clientId: string;
};

/** Client ID of Porter's user-assigned managed identity (infrastructure). */
function managedIdentityClientId(): string | undefined {
  return process.env.WAREHOUSE_MI_CLIENT_ID || undefined;
}

/**
 * True when the managed identity used for cross-tenant federation is present.
 * This is provisioned by bicep on Azure; it is absent in local dev, where
 * warehouse export is therefore reported as unavailable. The admin UI surfaces
 * this so operators know whether the infrastructure half is in place.
 */
export function isManagedIdentityConfigured(): boolean {
  return !!managedIdentityClientId();
}

function getWarehouseContainerClient(
  conn: WarehouseConnection,
  containerName: string
): ContainerClient {
  const miClientId = managedIdentityClientId();
  if (!conn.accountUrl || !conn.tenantId || !conn.clientId || !miClientId) {
    throw new Error("Warehouse export connection is not fully configured");
  }
  // Mint the managed-identity token on demand and hand it to the data-team app
  // as a federated client assertion (cross-tenant, secret-less).
  const miCredential = new ManagedIdentityCredential({ clientId: miClientId });
  const credential = new ClientAssertionCredential(conn.tenantId, conn.clientId, async () => {
    const token = await miCredential.getToken(TOKEN_EXCHANGE_SCOPE);
    if (!token) throw new Error("Failed to acquire managed-identity assertion for warehouse export");
    return token.token;
  });
  const blobServiceClient = new BlobServiceClient(conn.accountUrl, credential);
  return blobServiceClient.getContainerClient(containerName);
}

/**
 * Upload a Parquet buffer to the warehouse container, overwriting any existing
 * blob at the same name (uploads are keyed by uploadId, so a redelivery just
 * overwrites — idempotent). Returns the blob URL.
 */
export async function uploadParquetToWarehouse(
  conn: WarehouseConnection,
  containerName: string,
  blobName: string,
  buffer: Buffer
): Promise<string> {
  const containerClient = getWarehouseContainerClient(conn, containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: "application/vnd.apache.parquet" },
  });
  return blockBlobClient.url;
}
