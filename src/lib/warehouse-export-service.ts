/**
 * Admin-editable configuration for data-warehouse export.
 *
 * Mirrors src/lib/retention-service.ts: settings live in AppSetting (DB) so an
 * admin can change them from the UI without a redeploy. The whole destination —
 * the external account URL, the data-team app's tenant + client ID it federates
 * into, the container, and the root path — is configured here. The only piece
 * NOT here is Porter's own managed-identity client ID (WAREHOUSE_MI_CLIENT_ID),
 * which is infrastructure created by bicep; see src/lib/warehouse-storage.ts.
 */

import { prismaAdmin } from "./prisma-admin";

export const WAREHOUSE_EXPORT_KEYS = {
  ENABLED: "WAREHOUSE_EXPORT_ENABLED",
  ACCOUNT_URL: "WAREHOUSE_EXPORT_ACCOUNT_URL",
  TENANT_ID: "WAREHOUSE_EXPORT_TENANT_ID",
  CLIENT_ID: "WAREHOUSE_EXPORT_CLIENT_ID",
  CONTAINER: "WAREHOUSE_EXPORT_CONTAINER",
  ROOT_PATH: "WAREHOUSE_EXPORT_ROOT_PATH",
} as const;

export type WarehouseExportConfig = {
  /** Master switch — when false, exports are skipped (uploads stay NOT_EXPORTED). */
  enabled: boolean;
  /** External warehouse storage account URL, e.g. https://acct.blob.core.windows.net/ */
  accountUrl: string;
  /** Entra tenant ID of the data team that owns the federated app. */
  tenantId: string;
  /** Client (application) ID of the data-team app Porter federates into. */
  clientId: string;
  /** Target container name in the external warehouse account. */
  container: string;
  /** Root prefix within the container, e.g. "porter/bronze". May be empty. */
  rootPath: string;
};

export type WarehouseExportConfigInput = Partial<WarehouseExportConfig>;

/** Trim a root path to a clean prefix with no leading/trailing slashes. */
export function normalizeRootPath(raw: string): string {
  return raw.trim().replace(/^\/+|\/+$/g, "");
}

export async function getWarehouseExportConfig(): Promise<WarehouseExportConfig> {
  const rows = await prismaAdmin.appSetting.findMany({
    where: { key: { in: Object.values(WAREHOUSE_EXPORT_KEYS) as string[] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    enabled: map.get(WAREHOUSE_EXPORT_KEYS.ENABLED) === "true",
    accountUrl: map.get(WAREHOUSE_EXPORT_KEYS.ACCOUNT_URL) ?? "",
    tenantId: map.get(WAREHOUSE_EXPORT_KEYS.TENANT_ID) ?? "",
    clientId: map.get(WAREHOUSE_EXPORT_KEYS.CLIENT_ID) ?? "",
    container: map.get(WAREHOUSE_EXPORT_KEYS.CONTAINER) ?? "",
    rootPath: map.get(WAREHOUSE_EXPORT_KEYS.ROOT_PATH) ?? "",
  };
}

export async function setWarehouseExportConfig(
  input: WarehouseExportConfigInput
): Promise<WarehouseExportConfig> {
  const updates: Array<[string, string]> = [];
  if (input.enabled !== undefined) {
    updates.push([WAREHOUSE_EXPORT_KEYS.ENABLED, input.enabled ? "true" : "false"]);
  }
  if (input.accountUrl !== undefined) {
    updates.push([WAREHOUSE_EXPORT_KEYS.ACCOUNT_URL, input.accountUrl.trim()]);
  }
  if (input.tenantId !== undefined) {
    updates.push([WAREHOUSE_EXPORT_KEYS.TENANT_ID, input.tenantId.trim()]);
  }
  if (input.clientId !== undefined) {
    updates.push([WAREHOUSE_EXPORT_KEYS.CLIENT_ID, input.clientId.trim()]);
  }
  if (input.container !== undefined) {
    updates.push([WAREHOUSE_EXPORT_KEYS.CONTAINER, input.container.trim()]);
  }
  if (input.rootPath !== undefined) {
    updates.push([WAREHOUSE_EXPORT_KEYS.ROOT_PATH, normalizeRootPath(input.rootPath)]);
  }

  await Promise.all(
    updates.map(([key, value]) =>
      prismaAdmin.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );

  return getWarehouseExportConfig();
}
