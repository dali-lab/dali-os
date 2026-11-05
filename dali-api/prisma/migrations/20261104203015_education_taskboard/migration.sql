-- CreateEnum
CREATE TYPE "EducationPeriodKind" AS ENUM ('Term', 'Interim', 'Custom');

-- CreateEnum
CREATE TYPE "EducationTaskStatus" AS ENUM ('Backlog', 'Todo', 'Doing', 'Done');

-- CreateTable
CREATE TABLE "EducationPeriod" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "kind" "EducationPeriodKind" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "weekCount" INTEGER NOT NULL,
    "termId" TEXT,

    CONSTRAINT "EducationPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationMilestone" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "periodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startWeek" INTEGER NOT NULL,
    "endWeek" INTEGER NOT NULL,

    CONSTRAINT "EducationMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "periodId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "week" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "status" "EducationTaskStatus" NOT NULL DEFAULT 'Backlog',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "EducationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EducationPeriod_termId_key" ON "EducationPeriod"("termId");

-- CreateIndex
CREATE INDEX "EducationPeriod_startDate_idx" ON "EducationPeriod"("startDate");

-- CreateIndex
CREATE INDEX "EducationMilestone_periodId_idx" ON "EducationMilestone"("periodId");

-- CreateIndex
CREATE INDEX "EducationTask_periodId_week_idx" ON "EducationTask"("periodId", "week");

-- CreateIndex
CREATE INDEX "EducationTask_assigneeId_idx" ON "EducationTask"("assigneeId");

-- CreateIndex
CREATE INDEX "EducationTask_milestoneId_idx" ON "EducationTask"("milestoneId");

-- AddForeignKey
ALTER TABLE "EducationPeriod" ADD CONSTRAINT "EducationPeriod_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationMilestone" ADD CONSTRAINT "EducationMilestone_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "EducationPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationTask" ADD CONSTRAINT "EducationTask_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "EducationPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationTask" ADD CONSTRAINT "EducationTask_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "EducationMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationTask" ADD CONSTRAINT "EducationTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationTask" ADD CONSTRAINT "EducationTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
