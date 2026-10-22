-- CreateTable
CREATE TABLE "GalleryPost" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "caption" TEXT,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalleryPost_createdAt_idx" ON "GalleryPost"("createdAt");

-- CreateIndex
CREATE INDEX "GalleryPost_authorId_createdAt_idx" ON "GalleryPost"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "GalleryReaction_postId_idx" ON "GalleryReaction"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryReaction_postId_userId_emoji_key" ON "GalleryReaction"("postId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "GalleryComment_postId_createdAt_idx" ON "GalleryComment"("postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryReport_postId_reporterId_key" ON "GalleryReport"("postId", "reporterId");

-- AddForeignKey
ALTER TABLE "GalleryPost" ADD CONSTRAINT "GalleryPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryPost" ADD CONSTRAINT "GalleryPost_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryReaction" ADD CONSTRAINT "GalleryReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "GalleryPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryReaction" ADD CONSTRAINT "GalleryReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryComment" ADD CONSTRAINT "GalleryComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "GalleryPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryComment" ADD CONSTRAINT "GalleryComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryReport" ADD CONSTRAINT "GalleryReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "GalleryPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryReport" ADD CONSTRAINT "GalleryReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

