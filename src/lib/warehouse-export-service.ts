/**
 * Admin-editable configuration for data-warehouse export.
 *
 * Mirrors src/lib/retention-service.ts: settings live in AppSetting (DB) so an
 * admin can change them from the UI without a redeploy. Only the destination
 * (enabled toggle, container name, root path) is configurable here — the
 * connection identity (account URL + service-principal credentials) is a
 * deployment secret in env/Key Vault, see src/lib/warehouse-storage.ts.
 */

import { prismaAdmin } from "./prisma-admin";

export const WAREHOUSE_EXPORT_KEYS = {
  ENABLED: "WAREHOUSE_EXPORT_ENABLED",
  CONTAINER: "WAREHOUSE_EXPORT_CONTAINER",
  ROOT_PATH: "WAREHOUSE_EXPORT_ROOT_PATH",
} as const;

export type WarehouseExportConfig = {
  /** Master switch — when false, exports are skipped (uploads stay NOT_EXPORTED). */
  enabled: boolean;
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
