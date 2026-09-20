-- CreateEnum
CREATE TYPE "ChartStringType" AS ENUM ('GL', 'PTAEO');

-- CreateEnum
CREATE TYPE "ChartStringKind" AS ENUM ('ADVANCE', 'FUNDED', 'DEPARTMENT');

-- CreateTable
CREATE TABLE "ProjectChartString" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "termId" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "type" "ChartStringType" NOT NULL,
    "projectCode" TEXT NOT NULL,
    "subactivity" TEXT,
    "org" TEXT,
    "awardCode" TEXT,
    "fpNumber" TEXT,
    "awardId" TEXT,
    "rapportName" TEXT,
    "awardStart" TIMESTAMP(3),
    "awardEnd" TIMESTAMP(3),
    "kind" "ChartStringKind" NOT NULL DEFAULT 'FUNDED',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersedesId" TEXT,
    "supersedeReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ProjectChartString_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChartString_supersedesId_key" ON "ProjectChartString"("supersedesId");

-- CreateIndex
CREATE INDEX "ProjectChartString_projectId_termId_idx" ON "ProjectChartString"("projectId", "termId");

-- CreateIndex
CREATE INDEX "ProjectChartString_projectCode_idx" ON "ProjectChartString"("projectCode");

-- CreateIndex
CREATE INDEX "ProjectChartString_termId_idx" ON "ProjectChartString"("termId");

-- AddForeignKey
ALTER TABLE "ProjectChartString" ADD CONSTRAINT "ProjectChartString_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChartString" ADD CONSTRAINT "ProjectChartString_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChartString" ADD CONSTRAINT "ProjectChartString_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ProjectChartString"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChartString" ADD CONSTRAINT "ProjectChartString_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique indexes: Prisma's schema language can't express these, and
-- they are what actually enforce "at most one current chart string".
--
-- A plain @@unique([projectId, termId]) would be wrong twice over: it would
-- also constrain superseded history rows, and it would not constrain the
-- lab-wide defaults at all, because Postgres treats each NULL projectId as
-- distinct — the same trap BudgetEntry documents in its own comment. So the
-- guarantee is split in two, scoped to current rows only.

-- At most one current chart string per (project, term).
CREATE UNIQUE INDEX "ProjectChartString_current_project_term_key"
    ON "ProjectChartString" ("projectId", "termId")
    WHERE "isCurrent" AND "projectId" IS NOT NULL;

-- At most one current lab-wide default per term.
CREATE UNIQUE INDEX "ProjectChartString_current_default_term_key"
    ON "ProjectChartString" ("termId")
    WHERE "isCurrent" AND "projectId" IS NULL;
