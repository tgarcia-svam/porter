-- Add the project a file was uploaded under. Nullable so legacy rows and rows
-- whose schema→project mapping is ambiguous can stay unset.
ALTER TABLE "FileUpload" ADD COLUMN "projectId" TEXT;

CREATE INDEX "FileUpload_projectId_idx" ON "FileUpload"("projectId");

ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: set projectId for existing uploads whose schema is assigned to
-- exactly one project (unambiguous). Ambiguous / unassigned schemas stay null.
UPDATE "FileUpload" fu
SET "projectId" = sp."projectId"
FROM "SchemaProject" sp
WHERE sp."schemaId" = fu."schemaId"
  AND fu."projectId" IS NULL
  AND (SELECT COUNT(*) FROM "SchemaProject" s2 WHERE s2."schemaId" = fu."schemaId") = 1;
