-- CreateTable
CREATE TABLE "SlidePresentation" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "presenterId" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "build" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlidePresentation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlidePresentation_pageId_key" ON "SlidePresentation"("pageId");

-- AddForeignKey
ALTER TABLE "SlidePresentation" ADD CONSTRAINT "SlidePresentation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlidePresentation" ADD CONSTRAINT "SlidePresentation_presenterId_fkey" FOREIGN KEY ("presenterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
