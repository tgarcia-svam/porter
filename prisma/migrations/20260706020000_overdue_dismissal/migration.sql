-- Admin dismissal of a specific overdue obligation (schedule + org + schema +
-- due period) surfaced in the App Usage "Overdue Uploads" report.
CREATE TABLE "OverdueDismissal" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "dismissedByUserId" TEXT,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverdueDismissal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OverdueDismissal_scheduleId_organizationId_schemaId_dueDate_key"
    ON "OverdueDismissal"("scheduleId", "organizationId", "schemaId", "dueDate");

CREATE INDEX "OverdueDismissal_scheduleId_idx" ON "OverdueDismissal"("scheduleId");

ALTER TABLE "OverdueDismissal" ADD CONSTRAINT "OverdueDismissal_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "UploadSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
