-- CreateEnum
CREATE TYPE "ProjectShowcaseStatus" AS ENUM ('NotStarted', 'InProgress', 'NeedsReview', 'Published', 'Archive');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "publicVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "publicProfile" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectShowcase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ProjectShowcaseStatus" NOT NULL DEFAULT 'NotStarted',
    "tagline" TEXT,
    "displayName" TEXT,
    "year" INTEGER,
    "partners" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "techStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appUrl" TEXT,
    "websiteUrl" TEXT,
    "blogUrl" TEXT,
    "pressUrl" TEXT,
    "heroImageUrl" TEXT,
    "notionPageId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectShowcase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectShowcase_projectId_key" ON "ProjectShowcase"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectShowcase_notionPageId_key" ON "ProjectShowcase"("notionPageId");

-- CreateIndex
CREATE INDEX "ProjectShowcase_status_idx" ON "ProjectShowcase"("status");

-- AddForeignKey
ALTER TABLE "ProjectShowcase" ADD CONSTRAINT "ProjectShowcase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectShowcase" ADD CONSTRAINT "ProjectShowcase_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill User.publicProfile.
--
-- The public team directory this replaces (a Notion database mirrored onto
-- dali.website) listed every member who had ever been staffed, so defaulting
-- the new opt-in to false for everyone would silently empty that page on
-- cutover. Opt in exactly that population — anyone with a project or Core
-- assignment — leaving non-members (applicants, partner users) opted out.
UPDATE "User" SET "publicProfile" = true
WHERE "id" IN (SELECT "userId" FROM "ProjectAssignment")
   OR "id" IN (SELECT "userId" FROM "CoreAssignment");
