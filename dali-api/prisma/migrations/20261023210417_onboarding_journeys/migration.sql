-- CreateEnum
CREATE TYPE "OnboardingJourneyRole" AS ENUM ('Owner', 'Editor');

-- CreateTable
CREATE TABLE "OnboardingJourney" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "domainId" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "OnboardingJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingJourneyCollaborator" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journeyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OnboardingJourneyRole" NOT NULL,

    CONSTRAINT "OnboardingJourneyCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingJourneyProgress" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "journeyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completed" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "OnboardingJourneyProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingJourney_domainId_idx" ON "OnboardingJourney"("domainId");

-- CreateIndex
CREATE INDEX "OnboardingJourneyCollaborator_userId_idx" ON "OnboardingJourneyCollaborator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingJourneyCollaborator_journeyId_userId_key" ON "OnboardingJourneyCollaborator"("journeyId", "userId");

-- CreateIndex
CREATE INDEX "OnboardingJourneyProgress_userId_idx" ON "OnboardingJourneyProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingJourneyProgress_journeyId_userId_key" ON "OnboardingJourneyProgress"("journeyId", "userId");

-- AddForeignKey
ALTER TABLE "OnboardingJourney" ADD CONSTRAINT "OnboardingJourney_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJourney" ADD CONSTRAINT "OnboardingJourney_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJourneyCollaborator" ADD CONSTRAINT "OnboardingJourneyCollaborator_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "OnboardingJourney"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJourneyCollaborator" ADD CONSTRAINT "OnboardingJourneyCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJourneyProgress" ADD CONSTRAINT "OnboardingJourneyProgress_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "OnboardingJourney"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJourneyProgress" ADD CONSTRAINT "OnboardingJourneyProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
