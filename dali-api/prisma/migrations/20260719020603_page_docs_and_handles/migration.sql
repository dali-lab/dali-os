-- AlterEnum
ALTER TYPE "DocCommentTarget" ADD VALUE 'pagedoc';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "handle" TEXT;

-- CreateTable
CREATE TABLE "PageDoc" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB,
    "videoKey" TEXT,
    "maintainerId" TEXT,
    "createdById" TEXT,
    "lastEditedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageDoc_pageKey_key" ON "PageDoc"("pageKey");

-- CreateIndex
CREATE INDEX "PageDoc_maintainerId_idx" ON "PageDoc"("maintainerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- AddForeignKey
ALTER TABLE "PageDoc" ADD CONSTRAINT "PageDoc_maintainerId_fkey" FOREIGN KEY ("maintainerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDoc" ADD CONSTRAINT "PageDoc_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDoc" ADD CONSTRAINT "PageDoc_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
