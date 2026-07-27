-- Column comparison validation rules: admins define cross-column constraints
-- (e.g. StartDate <= EndDate) enforced on every uploaded row.

-- CreateEnum
CREATE TYPE "ComparisonOperator" AS ENUM ('LT', 'LTE', 'GT', 'GTE');

-- CreateTable
CREATE TABLE "SchemaColumnComparison" (
    "id"               TEXT NOT NULL,
    "schemaId"         TEXT NOT NULL,
    "sourceColumnName" TEXT NOT NULL,
    "operator"         "ComparisonOperator" NOT NULL,
    "targetColumnName" TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemaColumnComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchemaColumnComparison_schemaId_idx"
    ON "SchemaColumnComparison"("schemaId");

-- AddForeignKey
ALTER TABLE "SchemaColumnComparison"
    ADD CONSTRAINT "SchemaColumnComparison_schemaId_fkey"
    FOREIGN KEY ("schemaId") REFERENCES "Schema"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
