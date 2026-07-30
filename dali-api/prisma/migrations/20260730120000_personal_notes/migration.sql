-- CreateEnum
CREATE TYPE "SharePrincipalType" AS ENUM ('User', 'Group');

-- CreateEnum
CREATE TYPE "LabListingState" AS ENUM ('None', 'Proposed', 'Listed', 'Declined');

-- AlterEnum
--
-- Postgres 16 allows ALTER TYPE ... ADD VALUE inside a transaction; the new
-- value just can't be *used* in that same transaction. Nothing below writes a
-- 'Member' row, so this is safe as one migration.
ALTER TYPE "WorkspaceType" ADD VALUE 'Member';

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "labListing" "LabListingState" NOT NULL DEFAULT 'None',
ADD COLUMN     "labListingNote" TEXT,
ADD COLUMN     "labListingReviewedAt" TIMESTAMP(3),
ADD COLUMN     "labListingReviewedById" TEXT,
ADD COLUMN     "profileVisible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PageShare" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "principalType" "SharePrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageShare_principalType_principalId_idx" ON "PageShare"("principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "PageShare_pageId_principalType_principalId_key" ON "PageShare"("pageId", "principalType", "principalId");

-- AddForeignKey
ALTER TABLE "PageShare" ADD CONSTRAINT "PageShare_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
