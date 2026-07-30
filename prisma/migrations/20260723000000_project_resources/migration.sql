-- Admin-uploaded reference files scoped to a project, optionally restricted to
-- specific organizations. organizationIds = [] means visible to all orgs.
CREATE TABLE "ProjectResource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filePath" TEXT,
    "fileName" TEXT NOT NULL,
    "blobName" TEXT NOT NULL,
    "contentType" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectResource_projectId_deletedAt_idx" ON "ProjectResource"("projectId", "deletedAt");

ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
