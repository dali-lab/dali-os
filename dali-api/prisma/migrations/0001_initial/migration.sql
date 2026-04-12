Loaded Prisma config from prisma.config.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('Draft', 'Submitted', 'Withdrawn');

-- CreateEnum
CREATE TYPE "ApplicationCycleStatus" AS ENUM ('Draft', 'Open', 'Closed', 'DecisionsReleased');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "netId" TEXT,
    "daliEmail" TEXT,
    "dartmouthEmail" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DALIMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "daliEmail" TEXT,
    "dartmouthEmail" TEXT,
    "did" TEXT,

    CONSTRAINT "DALIMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationCycle" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "formVersionId" TEXT,

    CONSTRAINT "ApplicationCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationStatusUpdate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "newStatus" "ApplicationStatus" NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ApplicationStatusUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "answers" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "applicationFormVersionId" TEXT NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainApplication" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "answers" JSONB NOT NULL,
    "applicationId" TEXT NOT NULL,
    "challengeVersionId" TEXT NOT NULL,

    CONSTRAINT "DomainApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationForm" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationFormVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questions" JSONB NOT NULL,
    "applicationFormId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ApplicationFormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentorReview" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "feedback" TEXT NOT NULL DEFAULT '',
    "rejectionRationale" TEXT NOT NULL DEFAULT '',
    "overallRecommendation" TEXT,
    "annotations" JSONB NOT NULL DEFAULT '[]',
    "mentorId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "MentorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questions" JSONB NOT NULL,
    "challengeId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ChallengeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationCycleStatusUpdate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "newStatus" "ApplicationCycleStatus" NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ApplicationCycleStatusUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainApplicationCycle" (
    "domainId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "isReady" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DomainApplicationCycle_pkey" PRIMARY KEY ("domainId","applicationCycleId")
);

-- CreateTable
CREATE TABLE "ChallengeVersionApplicationCycle" (
    "challengeVersionId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,

    CONSTRAINT "ChallengeVersionApplicationCycle_pkey" PRIMARY KEY ("challengeVersionId","applicationCycleId")
);

-- CreateTable
CREATE TABLE "OAuthSession" (
    "id" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "redirectUri" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountType" TEXT,
    "userId" TEXT,
    "authorizationCode" TEXT,
    "exchanged" BOOLEAN NOT NULL DEFAULT false,
    "linkUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainLeadAssignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memberId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,

    CONSTRAINT "DomainLeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_netId_key" ON "User"("netId");

-- CreateIndex
CREATE UNIQUE INDEX "User_daliEmail_key" ON "User"("daliEmail");

-- CreateIndex
CREATE UNIQUE INDEX "User_dartmouthEmail_key" ON "User"("dartmouthEmail");

-- CreateIndex
CREATE UNIQUE INDEX "DALIMember_userId_key" ON "DALIMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DALIMember_daliEmail_key" ON "DALIMember"("daliEmail");

-- CreateIndex
CREATE UNIQUE INDEX "DALIMember_dartmouthEmail_key" ON "DALIMember"("dartmouthEmail");

-- CreateIndex
CREATE UNIQUE INDEX "DALIMember_did_key" ON "DALIMember"("did");

-- CreateIndex
CREATE UNIQUE INDEX "MentorReview_mentorId_applicationId_key" ON "MentorReview"("mentorId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthSession_authorizationCode_key" ON "OAuthSession"("authorizationCode");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "DALIMember" ADD CONSTRAINT "DALIMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationCycle" ADD CONSTRAINT "ApplicationCycle_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "ApplicationFormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationStatusUpdate" ADD CONSTRAINT "ApplicationStatusUpdate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationStatusUpdate" ADD CONSTRAINT "ApplicationStatusUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_applicationFormVersionId_fkey" FOREIGN KEY ("applicationFormVersionId") REFERENCES "ApplicationFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplication" ADD CONSTRAINT "DomainApplication_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplication" ADD CONSTRAINT "DomainApplication_challengeVersionId_fkey" FOREIGN KEY ("challengeVersionId") REFERENCES "ChallengeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationFormVersion" ADD CONSTRAINT "ApplicationFormVersion_applicationFormId_fkey" FOREIGN KEY ("applicationFormId") REFERENCES "ApplicationForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationFormVersion" ADD CONSTRAINT "ApplicationFormVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorReview" ADD CONSTRAINT "MentorReview_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorReview" ADD CONSTRAINT "MentorReview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVersion" ADD CONSTRAINT "ChallengeVersion_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVersion" ADD CONSTRAINT "ChallengeVersion_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVersion" ADD CONSTRAINT "ChallengeVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationCycleStatusUpdate" ADD CONSTRAINT "ApplicationCycleStatusUpdate_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationCycleStatusUpdate" ADD CONSTRAINT "ApplicationCycleStatusUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplicationCycle" ADD CONSTRAINT "DomainApplicationCycle_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainApplicationCycle" ADD CONSTRAINT "DomainApplicationCycle_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVersionApplicationCycle" ADD CONSTRAINT "ChallengeVersionApplicationCycle_challengeVersionId_fkey" FOREIGN KEY ("challengeVersionId") REFERENCES "ChallengeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeVersionApplicationCycle" ADD CONSTRAINT "ChallengeVersionApplicationCycle_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthSession" ADD CONSTRAINT "OAuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainLeadAssignment" ADD CONSTRAINT "DomainLeadAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainLeadAssignment" ADD CONSTRAINT "DomainLeadAssignment_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

