-- Configurable data visualizations (see prisma/schema.prisma). Replaces the
-- fixed time-series "Statistics" feature: a schema can now have any number of
-- admin-configured Visualizations (Indicator / Bar / Line), each aggregating a
-- column. The old Schema.timeSeriesColumn / timeSeriesGranularity columns and
-- the Granularity enum are removed.

-- CreateEnum
CREATE TYPE "VisualizationType" AS ENUM ('INDICATOR', 'BAR', 'LINE');
CREATE TYPE "AggregateFn" AS ENUM ('COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'MEDIAN');

-- CreateTable
CREATE TABLE "Visualization" (
    "id" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "type" "VisualizationType" NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "aggregate" "AggregateFn" NOT NULL,
    "valueColumn" TEXT NOT NULL,
    "xColumn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visualization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visualization_schemaId_order_idx" ON "Visualization"("schemaId", "order");

-- AddForeignKey
ALTER TABLE "Visualization" ADD CONSTRAINT "Visualization_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "Schema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the old time-series statistics config
ALTER TABLE "Schema" DROP COLUMN "timeSeriesColumn";
ALTER TABLE "Schema" DROP COLUMN "timeSeriesGranularity";
DROP TYPE "Granularity";
