-- CreateEnum
CREATE TYPE "LevelUpDecision" AS ENUM ('Approved', 'Declined');

-- AlterTable
ALTER TABLE "Domain" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "StaffingCycleFormBinding" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "LevelUpReview" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submissionId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "targetLevel" "Level" NOT NULL,
    "rubricVersionId" TEXT,
    "scores" JSONB NOT NULL,
    "decision" "LevelUpDecision" NOT NULL,
    "note" TEXT,
    "reviewerId" TEXT NOT NULL,

    CONSTRAINT "LevelUpReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LevelUpReview_submissionId_idx" ON "LevelUpReview"("submissionId");

-- CreateIndex
CREATE INDEX "LevelUpReview_subjectUserId_domainId_idx" ON "LevelUpReview"("subjectUserId", "domainId");

-- CreateIndex
CREATE UNIQUE INDEX "Form_systemKey_key" ON "Form"("systemKey");

