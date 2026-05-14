/**
 * Data-retention policy and cleanup logic.
 *
 * Two-tier model:
 *   1. Soft-delete FileUpload after N days (rows hidden from app queries,
 *      still recoverable until hard-delete).
 *   2. Hard-delete FileUpload after M days (UploadRow + ValidationResult
 *      cascade via onDelete: Cascade).
 *
 * AuditLog has no soft-delete — it's append-only by policy. Retention here
 * means hard-delete after R days.
 *
 * Settings live in AppSetting (DB), so they can be changed from the admin UI
 * without a redeploy. A value of 0 means "unlimited retention" (no action).
 *
 * Triggered by POST /api/admin/retention/run, which is wired into an Azure
 * scheduled job that runs once per day.
 */

import { prismaAdmin } from "./prisma-admin";

const MS_PER_DAY = 86_400_000;

export const RETENTION_KEYS = {
  UPLOAD_SOFT_DELETE_DAYS: "UPLOAD_SOFT_DELETE_DAYS",
  UPLOAD_HARD_DELETE_DAYS: "UPLOAD_HARD_DELETE_DAYS",
  AUDIT_LOG_RETENTION_DAYS: "AUDIT_LOG_RETENTION_DAYS",
} as const;

export type RetentionSettings = {
  /** Soft-delete uploads created more than this many days ago. 0 = never. */
  uploadSoftDeleteDays: number;
  /** Hard-delete uploads created more than this many days ago. 0 = never. */
  uploadHardDeleteDays: number;
  /** Hard-delete audit log entries older than this many days. 0 = never. */
  auditLogRetentionDays: number;
};

/** Settings shape that the API/UI exchanges — fields optional for partial PUTs. */
export type RetentionSettingsInput = Partial<RetentionSettings>;

function parseDays(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function getRetentionSettings(): Promise<RetentionSettings> {
  const rows = await prismaAdmin.appSetting.findMany({
    where: { key: { in: Object.values(RETENTION_KEYS) as string[] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    uploadSoftDeleteDays: parseDays(map.get(RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS)),
    uploadHardDeleteDays: parseDays(map.get(RETENTION_KEYS.UPLOAD_HARD_DELETE_DAYS)),
    auditLogRetentionDays: parseDays(map.get(RETENTION_KEYS.AUDIT_LOG_RETENTION_DAYS)),
  };
}

export async function setRetentionSettings(s: RetentionSettingsInput): Promise<RetentionSettings> {
  const updates: Array<[string, number]> = [];
  if (s.uploadSoftDeleteDays !== undefined) {
    updates.push([RETENTION_KEYS.UPLOAD_SOFT_DELETE_DAYS, Math.max(0, Math.floor(s.uploadSoftDeleteDays))]);
  }
  if (s.uploadHardDeleteDays !== undefined) {
    updates.push([RETENTION_KEYS.UPLOAD_HARD_DELETE_DAYS, Math.max(0, Math.floor(s.uploadHardDeleteDays))]);
  }
  if (s.auditLogRetentionDays !== undefined) {
    updates.push([RETENTION_KEYS.AUDIT_LOG_RETENTION_DAYS, Math.max(0, Math.floor(s.auditLogRetentionDays))]);
  }

  await Promise.all(
    updates.map(([key, value]) =>
      prismaAdmin.appSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  );

  return getRetentionSettings();
}

export type RetentionResult = {
  ranAt: string;
  settings: RetentionSettings;
  uploadsSoftDeleted: number;
  uploadsHardDeleted: number;
  auditLogsDeleted: number;
};

/**
 * Run a single retention sweep using the current AppSetting values.
 * Idempotent — running it twice in quick succession will simply find
 * nothing new to delete on the second pass.
 */
export async function runRetention(): Promise<RetentionResult> {
  const settings = await getRetentionSettings();
  const now = Date.now();

  let uploadsSoftDeleted = 0;
  let uploadsHardDeleted = 0;
  let auditLogsDeleted = 0;

  // Soft-delete first: mark uploads older than N days that aren't already deleted.
  if (settings.uploadSoftDeleteDays > 0) {
    const cutoff = new Date(now - settings.uploadSoftDeleteDays * MS_PER_DAY);
    const { count } = await prismaAdmin.fileUpload.updateMany({
      where: { createdAt: { lt: cutoff }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    uploadsSoftDeleted = count;
  }

  // Hard-delete: remove uploads older than M days regardless of soft-delete
  // state. Cascade FKs clear UploadRow + ValidationResult.
  if (settings.uploadHardDeleteDays > 0) {
    const cutoff = new Date(now - settings.uploadHardDeleteDays * MS_PER_DAY);
    const { count } = await prismaAdmin.fileUpload.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    uploadsHardDeleted = count;
  }

  // Audit log: hard-delete only.
  if (settings.auditLogRetentionDays > 0) {
    const cutoff = new Date(now - settings.auditLogRetentionDays * MS_PER_DAY);
    const { count } = await prismaAdmin.auditLog.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    auditLogsDeleted = count;
  }

  return {
    ranAt: new Date().toISOString(),
    settings,
    uploadsSoftDeleted,
    uploadsHardDeleted,
    auditLogsDeleted,
  };
}
