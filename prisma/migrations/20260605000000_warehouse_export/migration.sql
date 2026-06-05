-- Data-warehouse export tracking on FileUpload (see prisma/schema.prisma).
-- Additive only: a new enum plus nullable / defaulted columns. Existing rows
-- are backfilled with the column defaults; no data is touched or lost.

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('NOT_EXPORTED', 'EXPORTED', 'FAILED');

-- AlterTable
ALTER TABLE "FileUpload"
  ADD COLUMN "exportStatus" "ExportStatus" NOT NULL DEFAULT 'NOT_EXPORTED',
  ADD COLUMN "exportedAt" TIMESTAMP(3),
  ADD COLUMN "exportPath" TEXT,
  ADD COLUMN "exportError" TEXT,
  ADD COLUMN "exportAttempts" INTEGER NOT NULL DEFAULT 0;
