-- Typed classifications (see prisma/schema.prisma). A classification now carries
-- a data type: a text value-list (the previous behavior), a text regex, a number
-- range, or a date range. Additive only: a new enum plus a defaulted "type"
-- column and nullable type-specific columns. Existing rows default to VALUE_LIST,
-- preserving their `values` + `caseSensitive` semantics; no data is touched.

-- CreateEnum
CREATE TYPE "ClassificationType" AS ENUM ('VALUE_LIST', 'REGEX', 'NUMBER_RANGE', 'DATE_RANGE');

-- AlterTable
ALTER TABLE "Classification"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "type" "ClassificationType" NOT NULL DEFAULT 'VALUE_LIST',
  ADD COLUMN "pattern" TEXT,
  ADD COLUMN "minNumber" DOUBLE PRECISION,
  ADD COLUMN "maxNumber" DOUBLE PRECISION,
  ADD COLUMN "minDate" DATE,
  ADD COLUMN "maxDate" DATE;
