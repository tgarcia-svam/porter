-- Per-project upload frequency / due-date feature.
-- Adds UploadSchedule (1:1 with Project) + ScheduleNotification (idempotency
-- ledger for reminder/overdue emails). See prisma/schema.prisma. Additive only —
-- no existing data is touched, no backfill required.

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REMINDER', 'OVERDUE');

-- CreateTable
CREATE TABLE "UploadSchedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "monthOfQuarter" INTEGER,
    "monthOfYear" INTEGER,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderDaysBefore" INTEGER,
    "overdueEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleNotification" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "type" "NotificationType" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadSchedule_projectId_key" ON "UploadSchedule"("projectId");

-- CreateIndex
CREATE INDEX "ScheduleNotification_scheduleId_idx" ON "ScheduleNotification"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleNotification_scheduleId_organizationId_dueDate_type_key" ON "ScheduleNotification"("scheduleId", "organizationId", "dueDate", "type");

-- AddForeignKey
ALTER TABLE "UploadSchedule" ADD CONSTRAINT "UploadSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleNotification" ADD CONSTRAINT "ScheduleNotification_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "UploadSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
