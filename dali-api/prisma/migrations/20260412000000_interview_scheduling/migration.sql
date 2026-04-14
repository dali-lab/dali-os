-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleAccessToken" TEXT,
ADD COLUMN     "googleRefreshToken" TEXT,
ADD COLUMN     "googleTokenExpiresAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('Scheduled', 'Completed', 'CancelledByApplicant', 'CancelledByAdmin', 'NeedsReassignment');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('InDomain', 'CrossDomain');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('Active', 'Declined', 'Replaced');

-- CreateTable
CREATE TABLE "InterviewConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "dayStartHour" INTEGER NOT NULL DEFAULT 9,
    "dayEndHour" INTEGER NOT NULL DEFAULT 18,
    "interviewStartDate" TIMESTAMP(3) NOT NULL,
    "interviewEndDate" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',

    CONSTRAINT "InterviewConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleReviewer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "daliMemberId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CycleReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerAvailability" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cycleReviewerId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'Scheduled',

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewAssignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interviewId" TEXT NOT NULL,
    "cycleReviewerId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'Active',

    CONSTRAINT "InterviewAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewConfig_applicationCycleId_key" ON "InterviewConfig"("applicationCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "CycleReviewer_daliMemberId_applicationCycleId_key" ON "CycleReviewer"("daliMemberId", "applicationCycleId");

-- CreateIndex
CREATE INDEX "ReviewerAvailability_cycleReviewerId_startTime_endTime_idx" ON "ReviewerAvailability"("cycleReviewerId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "Interview_applicationCycleId_startTime_idx" ON "Interview"("applicationCycleId", "startTime");

-- CreateIndex
CREATE INDEX "Interview_applicationId_idx" ON "Interview"("applicationId");

-- CreateIndex
CREATE INDEX "InterviewAssignment_cycleReviewerId_status_idx" ON "InterviewAssignment"("cycleReviewerId", "status");

-- AddForeignKey
ALTER TABLE "InterviewConfig" ADD CONSTRAINT "InterviewConfig_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleReviewer" ADD CONSTRAINT "CycleReviewer_daliMemberId_fkey" FOREIGN KEY ("daliMemberId") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleReviewer" ADD CONSTRAINT "CycleReviewer_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleReviewer" ADD CONSTRAINT "CycleReviewer_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerAvailability" ADD CONSTRAINT "ReviewerAvailability_cycleReviewerId_fkey" FOREIGN KEY ("cycleReviewerId") REFERENCES "CycleReviewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewAssignment" ADD CONSTRAINT "InterviewAssignment_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewAssignment" ADD CONSTRAINT "InterviewAssignment_cycleReviewerId_fkey" FOREIGN KEY ("cycleReviewerId") REFERENCES "CycleReviewer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
