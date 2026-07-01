-- Local (username/password) authentication with MFA, reset, and lockout.
-- See prisma/schema.prisma (User, AuthToken). Additive only — no data is dropped.

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('PASSWORD', 'SSO');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('INVITE', 'RESET', 'MFA_ENROLL');

-- AlterTable: add auth + lockout columns.
-- The column default is PASSWORD (the choice for new users), but every row that
-- already exists was created for SSO and has no password — so backfill them to
-- SSO immediately after adding the column, before any login can occur. This keeps
-- current SSO users (incl. the seed admin) able to sign in.
ALTER TABLE "User"
  ADD COLUMN "authMethod" "AuthMethod" NOT NULL DEFAULT 'PASSWORD',
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecretEnc" TEXT,
  ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3),
  ADD COLUMN "lockedForReset" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "authMethod" = 'SSO';

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "secretEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_idx" ON "AuthToken"("userId");

-- CreateIndex
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
