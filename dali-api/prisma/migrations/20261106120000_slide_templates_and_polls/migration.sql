-- CreateEnum
CREATE TYPE "SlideTemplateKind" AS ENUM ('Deck', 'Slide');

-- AlterTable
ALTER TABLE "SlidePresentation" ADD COLUMN "closedPolls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "reactionsOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SlidePollVote" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "pollElementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choices" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlidePollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlideTemplate" (
    "id" TEXT NOT NULL,
    "kind" "SlideTemplateKind" NOT NULL,
    "workspaceType" "WorkspaceType" NOT NULL,
    "workspaceId" TEXT,
    "title" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "slideCount" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlideTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlidePollVote_presentationId_pollElementId_idx" ON "SlidePollVote"("presentationId", "pollElementId");

-- CreateIndex
CREATE UNIQUE INDEX "SlidePollVote_presentationId_pollElementId_userId_key" ON "SlidePollVote"("presentationId", "pollElementId", "userId");

-- CreateIndex
CREATE INDEX "SlideTemplate_workspaceType_workspaceId_kind_idx" ON "SlideTemplate"("workspaceType", "workspaceId", "kind");

-- AddForeignKey
ALTER TABLE "SlidePollVote" ADD CONSTRAINT "SlidePollVote_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "SlidePresentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlidePollVote" ADD CONSTRAINT "SlidePollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlideTemplate" ADD CONSTRAINT "SlideTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
