-- Per-visualization date bucketing. When a Bar/Line visualization's x-axis is a
-- DATE column, the admin can group by day, month, or year (see Visualization in
-- prisma/schema.prisma). Additive: re-introduces the Granularity enum and adds a
-- nullable column.

-- CreateEnum
CREATE TYPE "Granularity" AS ENUM ('DAY', 'MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "Visualization" ADD COLUMN "granularity" "Granularity";
