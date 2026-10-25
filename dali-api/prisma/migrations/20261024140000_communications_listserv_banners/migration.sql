-- CreateEnum
CREATE TYPE "ListservStatus" AS ENUM ('Submitted', 'ChangesRequested', 'Approved', 'Sent');

-- CreateEnum
CREATE TYPE "BannerKind" AS ENUM ('Image', 'Poster', 'Video', 'Text');

-- CreateEnum
CREATE TYPE "BannerTone" AS ENUM ('Accent', 'Amber', 'Card');

-- CreateEnum
CREATE TYPE "BannerTrigger" AS ENUM ('AppOpen', 'Page');

-- CreateEnum
CREATE TYPE "BannerFrequency" AS ENUM ('EveryOpen', 'Daily', 'Once');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "announcementId" TEXT;

-- CreateTable
CREATE TABLE "ListservSubmission" (
    "id" TEXT NOT NULL,
    "status" "ListservStatus" NOT NULL DEFAULT 'Submitted',
    "subject" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "sendBy" DATE,
    "note" TEXT,
    "feedback" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "sentOn" DATE,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListservSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListservConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "leadUserId" TEXT,
    "fromAddress" TEXT NOT NULL DEFAULT 'dali@dartmouth.edu',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListservConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BannerKind" NOT NULL DEFAULT 'Image',
    "mediaUrl" TEXT,
    "videoUrl" TEXT,
    "headline" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "ctaLabel" TEXT NOT NULL DEFAULT '',
    "ctaUrl" TEXT NOT NULL DEFAULT '',
    "tone" "BannerTone" NOT NULL DEFAULT 'Accent',
    "everyone" BOOLEAN NOT NULL DEFAULT false,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trigger" "BannerTrigger" NOT NULL DEFAULT 'AppOpen',
    "triggerPath" TEXT,
    "frequency" "BannerFrequency" NOT NULL DEFAULT 'EveryOpen',
    "allowSnooze" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerImpression" (
    "id" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "snoozes" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "snoozedDay" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerImpression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListservSubmission_status_sendBy_idx" ON "ListservSubmission"("status", "sendBy");

-- CreateIndex
CREATE INDEX "ListservSubmission_submittedById_idx" ON "ListservSubmission"("submittedById");

-- CreateIndex
CREATE INDEX "Banner_published_startsAt_endsAt_idx" ON "Banner"("published", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "BannerImpression_bannerId_userId_key" ON "BannerImpression"("bannerId", "userId");

-- AddForeignKey
ALTER TABLE "BannerImpression" ADD CONSTRAINT "BannerImpression_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
