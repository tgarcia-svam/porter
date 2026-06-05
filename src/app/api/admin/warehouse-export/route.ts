import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { apiForbidden, apiBadRequest, withHandler } from "@/lib/api-error";
import {
  getWarehouseExportConfig,
  setWarehouseExportConfig,
} from "@/lib/warehouse-export-service";
import { isWarehouseConfigured } from "@/lib/warehouse-storage";

const UpdateBody = z.object({
  enabled: z.boolean().optional(),
  container: z.string().max(256).optional(),
  rootPath: z.string().max(1024).optional(),
});

export const GET = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();
  const config = await getWarehouseExportConfig();
  // credentialsConfigured tells the UI whether the SP/connection env vars are
  // wired in this deployment (the secret itself is never returned).
  return NextResponse.json({ ...config, credentialsConfigured: isWarehouseConfigured() });
});

export const PUT = withHandler(async (req: NextRequest) => {
  const session = await requireAdmin(req);
  if (!session) return apiForbidden();

  const body = await req.json();
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) return apiBadRequest(parsed.error.flatten());

  // Guard against enabling export with no destination container.
  const next = { ...(await getWarehouseExportConfig()), ...parsed.data };
  if (next.enabled && !next.container.trim()) {
    return apiBadRequest("A container name is required to enable warehouse export.");
  }

  const config = await setWarehouseExportConfig(parsed.data);
  return NextResponse.json({ ...config, credentialsConfigured: isWarehouseConfigured() });
});
