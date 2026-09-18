-- CreateEnum
CREATE TYPE "DrawingType" AS ENUM ('GRUNDRISS', 'SCHNITT', 'ANSICHT', 'SCHEMA', 'PRINZIPSCHEMA', 'DETAIL', 'STRANGSCHEMA', 'ISOMETRIE');

-- CreateEnum
CREATE TYPE "DrawingFormat" AS ENUM ('A0', 'A1', 'A2', 'A3', 'A4', 'SONDER');

-- CreateEnum
CREATE TYPE "DrawingStatus" AS ENUM ('WIP', 'IN_CHECK', 'CHECKED', 'RELEASED', 'ISSUED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RevisionReason" AS ENUM ('ERSTAUSGABE', 'KUNDENWUNSCH', 'KOORDINATION', 'FEHLERKORREKTUR', 'BEHOERDE', 'AUSFUEHRUNG');

-- CreateEnum
CREATE TYPE "TransmittalPurpose" AS ENUM ('ZUR_INFORMATION', 'ZUR_PRUEFUNG', 'ZUR_AUSFUEHRUNG', 'ZUR_FREIGABE');

-- CreateEnum
CREATE TYPE "TransmittalMedium" AS ENUM ('EMAIL', 'POST', 'PLATTFORM', 'UEBERGABE');

-- CreateEnum
CREATE TYPE "RecipientRole" AS ENUM ('TO', 'CC');

-- CreateTable
CREATE TABLE "Drawing" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "buildingId" TEXT,
    "type" "DrawingType" NOT NULL,
    "scale" TEXT,
    "format" "DrawingFormat" NOT NULL DEFAULT 'A3',
    "phase" "SiaPhase",
    "status" "DrawingStatus" NOT NULL DEFAULT 'WIP',
    "currentRevision" TEXT,
    "drawnById" TEXT,
    "checkedById" TEXT,
    "approvedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Drawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingRevision" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL,
    "reason" "RevisionReason" NOT NULL DEFAULT 'ERSTAUSGABE',
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "drawnById" TEXT,
    "checkedById" TEXT,
    "approvedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "DrawingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transmittal" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "sentById" TEXT,
    "purpose" "TransmittalPurpose" NOT NULL DEFAULT 'ZUR_INFORMATION',
    "medium" "TransmittalMedium" NOT NULL DEFAULT 'EMAIL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Transmittal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransmittalItem" (
    "id" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "drawingRevisionId" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "format" "DrawingFormat",

    CONSTRAINT "TransmittalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransmittalRecipient" (
    "id" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "employeeId" TEXT,
    "externalName" TEXT,
    "externalOrg" TEXT,
    "externalMail" TEXT,
    "role" "RecipientRole" NOT NULL DEFAULT 'TO',
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "TransmittalRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Drawing_projectId_status_idx" ON "Drawing"("projectId", "status");

-- CreateIndex
CREATE INDEX "Drawing_disciplineId_idx" ON "Drawing"("disciplineId");

-- CreateIndex
CREATE INDEX "Drawing_buildingId_idx" ON "Drawing"("buildingId");

-- CreateIndex
CREATE INDEX "Drawing_status_updatedAt_idx" ON "Drawing"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Drawing_projectId_number_key" ON "Drawing"("projectId", "number");

-- CreateIndex
CREATE INDEX "DrawingRevision_drawingId_createdAt_idx" ON "DrawingRevision"("drawingId", "createdAt");

-- CreateIndex
CREATE INDEX "DrawingRevision_releasedAt_idx" ON "DrawingRevision"("releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingRevision_drawingId_revision_key" ON "DrawingRevision"("drawingId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Transmittal_number_key" ON "Transmittal"("number");

-- CreateIndex
CREATE INDEX "Transmittal_projectId_sentAt_idx" ON "Transmittal"("projectId", "sentAt");

-- CreateIndex
CREATE INDEX "TransmittalItem_drawingRevisionId_idx" ON "TransmittalItem"("drawingRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "TransmittalItem_transmittalId_drawingRevisionId_key" ON "TransmittalItem"("transmittalId", "drawingRevisionId");

-- CreateIndex
CREATE INDEX "TransmittalRecipient_transmittalId_idx" ON "TransmittalRecipient"("transmittalId");

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_drawnById_fkey" FOREIGN KEY ("drawnById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_drawnById_fkey" FOREIGN KEY ("drawnById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmittal" ADD CONSTRAINT "Transmittal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmittal" ADD CONSTRAINT "Transmittal_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransmittalItem" ADD CONSTRAINT "TransmittalItem_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransmittalItem" ADD CONSTRAINT "TransmittalItem_drawingRevisionId_fkey" FOREIGN KEY ("drawingRevisionId") REFERENCES "DrawingRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransmittalRecipient" ADD CONSTRAINT "TransmittalRecipient_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransmittalRecipient" ADD CONSTRAINT "TransmittalRecipient_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
