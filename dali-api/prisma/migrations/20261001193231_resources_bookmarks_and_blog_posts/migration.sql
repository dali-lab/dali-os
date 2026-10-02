-- CreateEnum
CREATE TYPE "BlogVisibility" AS ENUM ('Internal', 'Public');

-- CreateTable
CREATE TABLE "ResourceBookmark" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentJson" JSONB,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "coverImageUrl" TEXT,
    "visibility" "BlogVisibility" NOT NULL DEFAULT 'Internal',
    "publishedAt" TIMESTAMP(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceBookmark_position_idx" ON "ResourceBookmark"("position");

-- CreateIndex
CREATE INDEX "BlogPost_publishedAt_idx" ON "BlogPost"("publishedAt");

-- CreateIndex
CREATE INDEX "BlogPost_authorId_idx" ON "BlogPost"("authorId");

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the pre-bookmarks Resources document over as the first bookmark. Its
-- room is resources:lab:body, so the bookmark id must be "lab".
INSERT INTO "ResourceBookmark" ("id", "title", "position", "updatedAt")
SELECT 'lab', 'Lab guide', 0, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "CollabDocument" WHERE "name" = 'resources:lab:body');
