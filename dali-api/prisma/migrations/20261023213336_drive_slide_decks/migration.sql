-- AlterEnum
ALTER TYPE "PageKind" ADD VALUE 'Slides';

-- CreateTable
CREATE TABLE "SlideDeck" (
    "pageId" TEXT NOT NULL,
    "slides" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastEditedById" TEXT,

    CONSTRAINT "SlideDeck_pkey" PRIMARY KEY ("pageId")
);

-- AddForeignKey
ALTER TABLE "SlideDeck" ADD CONSTRAINT "SlideDeck_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
