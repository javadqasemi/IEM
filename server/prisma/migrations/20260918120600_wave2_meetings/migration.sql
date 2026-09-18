-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('KICKOFF', 'BAUSITZUNG', 'ABNAHME', 'INTERN', 'KUNDE');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PLANNED', 'HELD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingItemKind" AS ENUM ('INFORMATION', 'ENTSCHEID', 'PENDENZ');

-- CreateEnum
CREATE TYPE "MeetingApprovalDecision" AS ENUM ('APPROVED', 'AMENDED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('TECHNISCH', 'KOMMERZIELL', 'TERMIN', 'GESTALTUNG', 'ORGANISATORISCH');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('OFFEN', 'ENTSCHIEDEN', 'UMGESETZT', 'AUFGEHOBEN');

-- CreateEnum
CREATE TYPE "DecisionImpact" AS ENUM ('KOSTEN', 'TERMIN', 'QUALITAET', 'KEINE');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'BAUSITZUNG',
    "status" "MeetingStatus" NOT NULL DEFAULT 'PLANNED',
    "location" TEXT,
    "seriesNumber" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "projectId" TEXT,
    "organiserId" TEXT,
    "minutesSentAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "employeeId" TEXT,
    "externalName" TEXT,
    "externalOrg" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "invitedAt" TIMESTAMP(3),
    "attended" BOOLEAN,
    "apologised" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAgendaItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "durationMinutes" INTEGER,
    "presenterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "agendaItemId" TEXT,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "kind" "MeetingItemKind" NOT NULL DEFAULT 'INFORMATION',
    "taskId" TEXT,
    "decisionId" TEXT,
    "responsibleId" TEXT,
    "dueDate" TIMESTAMP(3),
    "disciplineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingApproval" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "decision" "MeetingApprovalDecision" NOT NULL,
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "meetingId" TEXT,
    "type" "DecisionType" NOT NULL DEFAULT 'TECHNISCH',
    "status" "DecisionStatus" NOT NULL DEFAULT 'ENTSCHIEDEN',
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "decidedById" TEXT,
    "decidedByExternal" TEXT,
    "disciplineId" TEXT,
    "impact" "DecisionImpact" NOT NULL DEFAULT 'KEINE',
    "costImpact" DECIMAL(12,2),
    "scheduleImpactDays" INTEGER,
    "supersedesId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_projectId_startsAt_idx" ON "Meeting"("projectId", "startsAt");

-- CreateIndex
CREATE INDEX "Meeting_status_startsAt_idx" ON "Meeting"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Meeting_type_seriesNumber_idx" ON "Meeting"("type", "seriesNumber");

-- CreateIndex
CREATE INDEX "MeetingAttendee_meetingId_idx" ON "MeetingAttendee"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_employeeId_idx" ON "MeetingAttendee"("employeeId");

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_meetingId_order_idx" ON "MeetingAgendaItem"("meetingId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAgendaItem_meetingId_order_key" ON "MeetingAgendaItem"("meetingId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingItem_decisionId_key" ON "MeetingItem"("decisionId");

-- CreateIndex
CREATE INDEX "MeetingItem_meetingId_order_idx" ON "MeetingItem"("meetingId", "order");

-- CreateIndex
CREATE INDEX "MeetingItem_kind_disciplineId_idx" ON "MeetingItem"("kind", "disciplineId");

-- CreateIndex
CREATE INDEX "MeetingItem_taskId_idx" ON "MeetingItem"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingItem_meetingId_order_key" ON "MeetingItem"("meetingId", "order");

-- CreateIndex
CREATE INDEX "MeetingApproval_meetingId_decidedAt_idx" ON "MeetingApproval"("meetingId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_supersedesId_key" ON "Decision"("supersedesId");

-- CreateIndex
CREATE INDEX "Decision_projectId_decidedAt_idx" ON "Decision"("projectId", "decidedAt");

-- CreateIndex
CREATE INDEX "Decision_status_decidedAt_idx" ON "Decision"("status", "decidedAt");

-- CreateIndex
CREATE INDEX "Decision_disciplineId_idx" ON "Decision"("disciplineId");

-- CreateIndex
CREATE INDEX "Decision_meetingId_idx" ON "Decision"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_projectId_number_key" ON "Decision"("projectId", "number");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organiserId_fkey" FOREIGN KEY ("organiserId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_presenterId_fkey" FOREIGN KEY ("presenterId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingItem" ADD CONSTRAINT "MeetingItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingItem" ADD CONSTRAINT "MeetingItem_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "MeetingAgendaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingItem" ADD CONSTRAINT "MeetingItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingItem" ADD CONSTRAINT "MeetingItem_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingItem" ADD CONSTRAINT "MeetingItem_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingItem" ADD CONSTRAINT "MeetingItem_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingApproval" ADD CONSTRAINT "MeetingApproval_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingApproval" ADD CONSTRAINT "MeetingApproval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
