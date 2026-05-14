-- Soft-delete column for FileUpload retention policy.
-- Rows with deletedAt IS NOT NULL are hidden from user-facing queries but
-- preserved until hard-delete by the retention worker.
ALTER TABLE "FileUpload" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Retention scans filter by these columns — indexes make the daily sweep
-- fast even at millions of rows.
CREATE INDEX "FileUpload_deletedAt_idx" ON "FileUpload"("deletedAt");
CREATE INDEX "FileUpload_createdAt_idx" ON "FileUpload"("createdAt");
