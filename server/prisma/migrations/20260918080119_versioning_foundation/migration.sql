-- CreateEnum
CREATE TYPE "RevisionScheme" AS ENUM ('NUMERIC', 'ALPHA');

-- CreateTable
CREATE TABLE "EntityVersion" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scheme" "RevisionScheme" NOT NULL DEFAULT 'NUMERIC',
    "label" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "changed" TEXT[],
    "note" TEXT,
    "changedById" TEXT,
    "changedByEmail" TEXT,
    "changedByName" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityVersion_entity_entityId_createdAt_idx" ON "EntityVersion"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "EntityVersion_correlationId_idx" ON "EntityVersion"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityVersion_entity_entityId_version_key" ON "EntityVersion"("entity", "entityId", "version");
