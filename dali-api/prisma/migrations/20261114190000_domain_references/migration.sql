-- CreateTable
CREATE TABLE "DomainReference" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "previewUrl" TEXT,
    "fileName" TEXT,
    "title" TEXT NOT NULL,
    "creatorName" TEXT,
    "daliMade" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainReference_domainId_createdAt_idx" ON "DomainReference"("domainId", "createdAt");

-- AddForeignKey
ALTER TABLE "DomainReference" ADD CONSTRAINT "DomainReference_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainReference" ADD CONSTRAINT "DomainReference_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
