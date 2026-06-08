import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";
import {
  getWarehouseExportConfig,
  setWarehouseExportConfig,
} from "@/lib/warehouse-export-service";
import { isManagedIdentityConfigured } from "@/lib/warehouse-storage";

const UpdateBody = z.object({
  enabled: z.boolean().optional(),
  accountUrl: z.string().max(512).optional(),
  tenantId: z.string().max(128).optional(),
  clientId: z.string().max(128).optional(),
  container: z.string().max(256).optional(),
  rootPath: z.string().max(1024).optional(),
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();
  const config = await getWarehouseExportConfig();
  // managedIdentityConfigured tells the UI whether the bicep-provisioned
  // managed identity (WAREHOUSE_MI_CLIENT_ID) is present in this deployment —
  // the one piece of the integration that isn't admin-editable.
  return NextResponse.json({ ...config, managedIdentityConfigured: isManagedIdentityConfigured() });
});

export const PUT = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  // Guard against enabling export before the destination is fully specified.
  const next = { ...(await getWarehouseExportConfig()), ...parsed.data };
  if (next.enabled) {
    const missing = [
      ["account URL", next.accountUrl],
      ["tenant ID", next.tenantId],
      ["client ID", next.clientId],
      ["container", next.container],
    ]
      .filter(([, v]) => !String(v).trim())
      .map(([label]) => label);
    if (missing.length > 0) {
      return apiBadRequest(`Cannot enable warehouse export — missing: ${missing.join(", ")}.`);
    }
  }

  const config = await setWarehouseExportConfig(parsed.data);
  return NextResponse.json({ ...config, managedIdentityConfigured: isManagedIdentityConfigured() });
});
