-- Performance indexes to speed up manual-entry / latest-data load times.

-- FileUpload: "find the most recent VALID upload for this schema" scans a
-- significant portion of FileUpload without this index. With it, Postgres
-- can jump directly to the head of the relevant (schemaId, status) group.
-- Status comes before createdAt in the key so the index also serves status
-- counts and filtered listings.
CREATE INDEX IF NOT EXISTS "FileUpload_schemaId_status_createdAt_idx"
  ON "FileUpload"("schemaId", "status", "createdAt" DESC);

-- UploadRow: paginated reads (orderBy rowIndex ASC, skip/take) were doing a
-- sort over every row belonging to the upload. Compound index serves both
-- the filter and the sort in one index scan.
CREATE INDEX IF NOT EXISTS "UploadRow_uploadId_rowIndex_idx"
  ON "UploadRow"("uploadId", "rowIndex");
