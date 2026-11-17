-- CreateEnum
CREATE TYPE "OpportunityPostKind" AS ENUM ('Job', 'ChatAsk', 'DaliUpdate');

-- CreateEnum
CREATE TYPE "OpportunityResponseKind" AS ENUM ('Interested', 'ChatOffer');

-- AlterTable
ALTER TABLE "PartnerReferral" ADD COLUMN     "partnerApplicationId" TEXT;

-- CreateTable
CREATE TABLE "OpportunityPost" (
    "id" TEXT NOT NULL,
    "kind" "OpportunityPostKind" NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "topic" TEXT,
    "jobUrl" TEXT,
    "companyName" TEXT,
    "companyDomain" TEXT,
    "logoKey" TEXT,
    "blockColor" TEXT,
    "role" TEXT,
    "location" TEXT,
    "jobType" TEXT,
    "willRefer" BOOLEAN NOT NULL DEFAULT false,
    "imageKey" TEXT,
    "partnerReferralId" TEXT,
    "stillOpenAskedAt" TIMESTAMP(3),
    "confirmedOpenAt" TIMESTAMP(3),
    "linkCheckedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityResponse" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "OpportunityResponseKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityPost_partnerReferralId_key" ON "OpportunityPost"("partnerReferralId");

-- CreateIndex
CREATE INDEX "OpportunityPost_createdAt_idx" ON "OpportunityPost"("createdAt");

-- CreateIndex
CREATE INDEX "OpportunityPost_authorId_idx" ON "OpportunityPost"("authorId");

-- CreateIndex
CREATE INDEX "OpportunityReaction_postId_idx" ON "OpportunityReaction"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityReaction_postId_userId_emoji_key" ON "OpportunityReaction"("postId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "OpportunityComment_postId_idx" ON "OpportunityComment"("postId");

-- CreateIndex
CREATE INDEX "OpportunityResponse_postId_idx" ON "OpportunityResponse"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityResponse_postId_userId_kind_key" ON "OpportunityResponse"("postId", "userId", "kind");

-- AddForeignKey
ALTER TABLE "OpportunityPost" ADD CONSTRAINT "OpportunityPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityReaction" ADD CONSTRAINT "OpportunityReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OpportunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityReaction" ADD CONSTRAINT "OpportunityReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityComment" ADD CONSTRAINT "OpportunityComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OpportunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityComment" ADD CONSTRAINT "OpportunityComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityResponse" ADD CONSTRAINT "OpportunityResponse_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OpportunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityResponse" ADD CONSTRAINT "OpportunityResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
