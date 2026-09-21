-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('DATABASE', 'MEDIA', 'FULL');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('QUEUED', 'RUNNING', 'VERIFYING', 'SUCCESS', 'FAILED', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_RESTORE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupArtifactKind" AS ENUM ('DATABASE_DUMP', 'MEDIA_ARCHIVE', 'MANIFEST');

-- CreateEnum
CREATE TYPE "RestoreMode" AS ENUM ('DRILL', 'IN_PLACE');

-- CreateEnum
CREATE TYPE "RestoreStatus" AS ENUM ('REQUESTED', 'RUNNING', 'VALIDATING', 'SUCCESS', 'FAILED', 'ABORTED');

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "BackupTrigger" NOT NULL,
    "triggeredById" TEXT,
    "occurrenceKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "sizeBytes" BIGINT,
    "appVersion" TEXT,
    "databaseVersion" TEXT,
    "migrationVersion" TEXT,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verificationDetail" TEXT,
    "failureCategory" TEXT,
    "failureDetail" TEXT,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupArtifact" (
    "id" TEXT NOT NULL,
    "backupRunId" TEXT NOT NULL,
    "kind" "BackupArtifactKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreRun" (
    "id" TEXT NOT NULL,
    "backupRunId" TEXT NOT NULL,
    "mode" "RestoreMode" NOT NULL,
    "status" "RestoreStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "targetDatabase" TEXT NOT NULL,
    "preRestoreBackupId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "failureCategory" TEXT,
    "failureDetail" TEXT,
    "validation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestoreRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupRun_occurrenceKey_key" ON "BackupRun"("occurrenceKey");

-- CreateIndex
CREATE INDEX "BackupRun_status_createdAt_idx" ON "BackupRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BackupRun_type_status_idx" ON "BackupRun"("type", "status");

-- CreateIndex
CREATE INDEX "BackupRun_expiresAt_idx" ON "BackupRun"("expiresAt");

-- CreateIndex
CREATE INDEX "BackupArtifact_backupRunId_idx" ON "BackupArtifact"("backupRunId");

-- CreateIndex
CREATE UNIQUE INDEX "BackupArtifact_backupRunId_kind_key" ON "BackupArtifact"("backupRunId", "kind");

-- CreateIndex
CREATE INDEX "RestoreRun_status_createdAt_idx" ON "RestoreRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RestoreRun_backupRunId_idx" ON "RestoreRun"("backupRunId");

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupArtifact" ADD CONSTRAINT "BackupArtifact_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "BackupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreRun" ADD CONSTRAINT "RestoreRun_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "BackupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreRun" ADD CONSTRAINT "RestoreRun_preRestoreBackupId_fkey" FOREIGN KEY ("preRestoreBackupId") REFERENCES "BackupRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreRun" ADD CONSTRAINT "RestoreRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
