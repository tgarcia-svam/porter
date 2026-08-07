-- Soft-delete support for User. deletedAt = non-null means deactivated.
-- FileUpload and ProjectResource retain their rows when a user is deactivated;
-- the userId / uploadedByUserId foreign keys become nullable with SET NULL so
-- the rows survive the user's removal from the active user set.

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Make FileUpload.userId nullable and relax the FK to SET NULL
ALTER TABLE "FileUpload" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "FileUpload" DROP CONSTRAINT "FileUpload_userId_fkey";
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Make ProjectResource.uploadedByUserId nullable and relax the FK to SET NULL
ALTER TABLE "ProjectResource" ALTER COLUMN "uploadedByUserId" DROP NOT NULL;
ALTER TABLE "ProjectResource" DROP CONSTRAINT "ProjectResource_uploadedByUserId_fkey";
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
