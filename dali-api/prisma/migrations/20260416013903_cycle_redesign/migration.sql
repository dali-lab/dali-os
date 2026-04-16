/*
  Warnings:

  - The values [Closed,DecisionsReleased] on the enum `ApplicationCycleStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [NeedsReassignment] on the enum `InterviewStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `applicationFormVersionId` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `formVersionId` on the `ApplicationCycle` table. All the data in the column will be lost.
  - You are about to drop the column `rubricVersionId` on the `ChallengeVersion` table. All the data in the column will be lost.
  - You are about to drop the column `isLead` on the `CycleReviewer` table. All the data in the column will be lost.
  - You are about to drop the column `applicationId` on the `Interview` table. All the data in the column will be lost.
  - You are about to drop the column `cycleReviewerId` on the `InterviewAssignment` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `InterviewAssignment` table. All the data in the column will be lost.
  - You are about to drop the column `applicationFormVersionId` on the `RubricVersion` table. All the data in the column will be lost.
  - You are about to drop the `ApplicationForm` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ApplicationFormVersion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MentorReview` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReviewerAvailability` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[daliMemberId,applicationCycleId,domainId]` on the table `CycleReviewer` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `generalChallengeVersionId` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `domainApplicationId` to the `Interview` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cycleInterviewerId` to the `InterviewAssignment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('Rejected', 'InvitedToInterview', 'Accepted', 'Waitlisted');

-- CreateEnum
CREATE TYPE "DecisionStage" AS ENUM ('Draft', 'Final', 'Released');

-- CreateEnum
CREATE TYPE "DelibsType" AS ENUM ('Initial', 'Final');

-- CreateEnum
CREATE TYPE "DelibsStatus" AS ENUM ('Active', 'Closed');

-- AlterEnum
BEGIN;
CREATE TYPE "ApplicationCycleStatus_new" AS ENUM ('Draft', 'Open', 'UnderReview', 'Completed');
ALTER TABLE "ApplicationCycleStatusUpdate" ALTER COLUMN "newStatus" TYPE "ApplicationCycleStatus_new" USING ("newStatus"::text::"ApplicationCycleStatus_new");
ALTER TYPE "ApplicationCycleStatus" RENAME TO "ApplicationCycleStatus_old";
ALTER TYPE "ApplicationCycleStatus_new" RENAME TO "ApplicationCycleStatus";
DROP TYPE "public"."ApplicationCycleStatus_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "InterviewStatus_new" AS ENUM ('Scheduled', 'Completed', 'CancelledByApplicant', 'CancelledByAdmin');
ALTER TABLE "public"."Interview" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Interview" ALTER COLUMN "status" TYPE "InterviewStatus_new" USING ("status"::text::"InterviewStatus_new");
ALTER TYPE "InterviewStatus" RENAME TO "InterviewStatus_old";
ALTER TYPE "InterviewStatus_new" RENAME TO "InterviewStatus";
DROP TYPE "public"."InterviewStatus_old";
ALTER TABLE "Interview" ALTER COLUMN "status" SET DEFAULT 'Scheduled';
COMMIT;

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_applicationFormVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ApplicationCycle" DROP CONSTRAINT "ApplicationCycle_formVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ApplicationCycleStatusUpdate" DROP CONSTRAINT "ApplicationCycleStatusUpdate_userId_fkey";

-- DropForeignKey
ALTER TABLE "ApplicationFormVersion" DROP CONSTRAINT "ApplicationFormVersion_applicationFormId_fkey";

-- DropForeignKey
ALTER TABLE "ApplicationFormVersion" DROP CONSTRAINT "ApplicationFormVersion_createdById_fkey";

-- DropForeignKey
ALTER TABLE "ChallengeVersion" DROP CONSTRAINT "ChallengeVersion_domainId_fkey";

-- DropForeignKey
ALTER TABLE "ChallengeVersion" DROP CONSTRAINT "ChallengeVersion_rubricVersionId_fkey";

-- DropForeignKey
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "InterviewAssignment" DROP CONSTRAINT "InterviewAssignment_cycleReviewerId_fkey";

-- DropForeignKey
ALTER TABLE "MentorReview" DROP CONSTRAINT "MentorReview_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "MentorReview" DROP CONSTRAINT "MentorReview_mentorId_fkey";

-- DropForeignKey
ALTER TABLE "ReviewerAvailability" DROP CONSTRAINT "ReviewerAvailability_cycleReviewerId_fkey";

-- DropForeignKey
ALTER TABLE "RubricVersion" DROP CONSTRAINT "RubricVersion_applicationFormVersionId_fkey";

-- DropIndex
DROP INDEX "CycleReviewer_daliMemberId_applicationCycleId_key";

-- DropIndex
DROP INDEX "Interview_applicationId_idx";

-- DropIndex
DROP INDEX "InterviewAssignment_cycleReviewerId_status_idx";

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "applicationFormVersionId",
ADD COLUMN     "generalChallengeVersionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ApplicationCycle" DROP COLUMN "formVersionId",
ADD COLUMN     "closeDate" TIMESTAMP(3),
ADD COLUMN     "generalRubricVersionId" TEXT;

-- AlterTable
ALTER TABLE "ApplicationCycleStatusUpdate" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ChallengeVersion" DROP COLUMN "rubricVersionId",
ALTER COLUMN "domainId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CycleReviewer" DROP COLUMN "isLead";

-- AlterTable
ALTER TABLE "DomainApplicationCycle" ADD COLUMN     "reviewersPerApplication" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "rubricVersionId" TEXT;

-- AlterTable
ALTER TABLE "Interview" DROP COLUMN "applicationId",
ADD COLUMN     "domainApplicationId" TEXT NOT NULL,
ADD COLUMN     "recommendation" TEXT,
ADD COLUMN     "recommendationNotes" TEXT;

-- AlterTable
ALTER TABLE "InterviewAssignment" DROP COLUMN "cycleReviewerId",
DROP COLUMN "notes",
ADD COLUMN     "cycleInterviewerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RubricVersion" DROP COLUMN "applicationFormVersionId";

-- DropTable
DROP TABLE "ApplicationForm";

-- DropTable
DROP TABLE "ApplicationFormVersion";

-- DropTable
DROP TABLE "MentorReview";

-- DropTable
DROP TABLE "ReviewerAvailability";

-- CreateTable
CREATE TABLE "CycleInterviewer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "daliMemberId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,

    CONSTRAINT "CycleInterviewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewerAvailability" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cycleInterviewerId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewNoteVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interviewAssignmentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "InterviewNoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domainApplicationId" TEXT NOT NULL,
    "type" "DecisionType" NOT NULL,
    "stage" "DecisionStage" NOT NULL,
    "madeById" TEXT NOT NULL,
    "notes" TEXT,
    "waitlistRank" INTEGER,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationReview" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "domainApplicationId" TEXT NOT NULL,
    "cycleReviewerId" TEXT NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "feedback" TEXT NOT NULL DEFAULT '',
    "rejectionRationale" TEXT NOT NULL DEFAULT '',
    "overallRecommendation" TEXT,
    "annotations" JSONB NOT NULL DEFAULT '[]',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,

    CONSTRAINT "ApplicationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelibsSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "domainId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "type" "DelibsType" NOT NULL,
    "status" "DelibsStatus" NOT NULL DEFAULT 'Active',
    "columnOrder" JSONB NOT NULL DEFAULT '{}',
    "openedById" TEXT NOT NULL,

    CONSTRAINT "DelibsSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CycleInterviewer_daliMemberId_applicationCycleId_domainId_key" ON "CycleInterviewer"("daliMemberId", "applicationCycleId", "domainId");

-- CreateIndex
CREATE INDEX "InterviewerAvailability_cycleInterviewerId_startTime_endTim_idx" ON "InterviewerAvailability"("cycleInterviewerId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "InterviewNoteVersion_interviewAssignmentId_createdAt_idx" ON "InterviewNoteVersion"("interviewAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_domainApplicationId_createdAt_idx" ON "Decision"("domainApplicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationReview_cycleReviewerId_domainApplicationId_key" ON "ApplicationReview"("cycleReviewerId", "domainApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "DelibsSession_domainId_applicationCycleId_type_key" ON "DelibsSession"("domainId", "applicationCycleId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CycleReviewer_daliMemberId_applicationCycleId_domainId_key" ON "CycleReviewer"("daliMemberId", "applicationCycleId", "domainId");

-- CreateIndex
CREATE INDEX "Interview_domainApplicationId_status_idx" ON "Interview"("domainApplicationId", "status");

-- CreateIndex
CREATE INDEX "InterviewAssignment_cycleInterviewerId_status_idx" ON "InterviewAssignment"("cycleInterviewerId", "status");

-- AddForeignKey
ALTER TABLE "ApplicationCycle" ADD CONSTRAINT "ApplicationCycle_generalRubricVersionId_fkey" FOREIGN KEY ("generalRubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_generalChallengeVersionId_fkey" FOREIGN KEY ("generalChallengeVersionId") REFERENCES "ChallengeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVersion" ADD CONSTRAINT "ChallengeVersion_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationCycleStatusUpdate" ADD CONSTRAINT "ApplicationCycleStatusUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplicationCycle" ADD CONSTRAINT "DomainApplicationCycle_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleInterviewer" ADD CONSTRAINT "CycleInterviewer_daliMemberId_fkey" FOREIGN KEY ("daliMemberId") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleInterviewer" ADD CONSTRAINT "CycleInterviewer_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleInterviewer" ADD CONSTRAINT "CycleInterviewer_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewerAvailability" ADD CONSTRAINT "InterviewerAvailability_cycleInterviewerId_fkey" FOREIGN KEY ("cycleInterviewerId") REFERENCES "CycleInterviewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_domainApplicationId_fkey" FOREIGN KEY ("domainApplicationId") REFERENCES "DomainApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewAssignment" ADD CONSTRAINT "InterviewAssignment_cycleInterviewerId_fkey" FOREIGN KEY ("cycleInterviewerId") REFERENCES "CycleInterviewer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewNoteVersion" ADD CONSTRAINT "InterviewNoteVersion_interviewAssignmentId_fkey" FOREIGN KEY ("interviewAssignmentId") REFERENCES "InterviewAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_domainApplicationId_fkey" FOREIGN KEY ("domainApplicationId") REFERENCES "DomainApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_madeById_fkey" FOREIGN KEY ("madeById") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationReview" ADD CONSTRAINT "ApplicationReview_domainApplicationId_fkey" FOREIGN KEY ("domainApplicationId") REFERENCES "DomainApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationReview" ADD CONSTRAINT "ApplicationReview_cycleReviewerId_fkey" FOREIGN KEY ("cycleReviewerId") REFERENCES "CycleReviewer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationReview" ADD CONSTRAINT "ApplicationReview_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "DALIMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelibsSession" ADD CONSTRAINT "DelibsSession_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelibsSession" ADD CONSTRAINT "DelibsSession_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelibsSession" ADD CONSTRAINT "DelibsSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
