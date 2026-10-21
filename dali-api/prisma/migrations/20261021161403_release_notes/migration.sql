-- CreateEnum
CREATE TYPE "ReleaseNoteStatus" AS ENUM ('Draft', 'Published', 'Dismissed');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "releaseNotesSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReleaseNote" (
    "id" TEXT NOT NULL,
    "status" "ReleaseNoteStatus" NOT NULL DEFAULT 'Draft',
    "title" TEXT NOT NULL,
    "contentJson" JSONB,
    "summary" TEXT NOT NULL,
    "area" TEXT,
    "prNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "videoKey" TEXT,
    "videoSource" TEXT,
    "posterKey" TEXT,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "allMembers" BOOLEAN NOT NULL DEFAULT true,
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slackTs" TEXT,
    "draftedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "recapWeek" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReleaseNote_status_publishedAt_idx" ON "ReleaseNote"("status", "publishedAt");
