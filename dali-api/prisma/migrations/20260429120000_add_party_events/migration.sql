-- CreateEnum
CREATE TYPE "PartyEventType" AS ENUM ('PARTY_VISIT', 'CODE_UNLOCK_SUCCESS', 'CODE_UNLOCK_FAILURE', 'DINO_REWARD_EARNED', 'LOGO_TRAIL_TRIGGERED');

-- CreateEnum
CREATE TYPE "PartyAudience" AS ENUM ('member', 'applicant');

-- CreateTable
CREATE TABLE "PartyEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "audience" "PartyAudience" NOT NULL,
    "eventType" "PartyEventType" NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "PartyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyEvent_eventType_createdAt_idx" ON "PartyEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "PartyEvent_userId_idx" ON "PartyEvent"("userId");

-- AddForeignKey
ALTER TABLE "PartyEvent" ADD CONSTRAINT "PartyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
