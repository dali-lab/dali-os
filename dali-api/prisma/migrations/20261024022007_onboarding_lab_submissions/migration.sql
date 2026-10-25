-- CreateEnum
CREATE TYPE "OnboardingLabSubmissionStatus" AS ENUM ('InProgress', 'Submitted', 'Approved', 'ChangesRequested');

-- CreateTable
CREATE TABLE "OnboardingLabSubmission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "journeyId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "work" JSONB NOT NULL,
    "selfChecks" JSONB NOT NULL DEFAULT '{}',
    "mentorChecks" JSONB NOT NULL DEFAULT '{}',
    "status" "OnboardingLabSubmissionStatus" NOT NULL DEFAULT 'InProgress',
    "mentorNote" TEXT,
    "reviewerId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "OnboardingLabSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingLabSubmission_journeyId_status_idx" ON "OnboardingLabSubmission"("journeyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingLabSubmission_journeyId_moduleId_userId_key" ON "OnboardingLabSubmission"("journeyId", "moduleId", "userId");

-- AddForeignKey
ALTER TABLE "OnboardingLabSubmission" ADD CONSTRAINT "OnboardingLabSubmission_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "OnboardingJourney"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingLabSubmission" ADD CONSTRAINT "OnboardingLabSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingLabSubmission" ADD CONSTRAINT "OnboardingLabSubmission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
