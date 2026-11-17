-- CreateTable
CREATE TABLE "CritSubmission" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "authorId" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "previewUrl" TEXT,
    "fileName" TEXT,
    "title" TEXT NOT NULL,
    "question" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "CritSubmission_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "CritSubmission_domainId_createdAt_idx" ON "CritSubmission"("domainId", "createdAt");

-- CreateIndex
CREATE INDEX "CritSubmission_authorId_idx" ON "CritSubmission"("authorId");

-- CreateIndex
CREATE INDEX "DomainReference_domainId_createdAt_idx" ON "DomainReference"("domainId", "createdAt");

-- CreateIndex
CREATE INDEX "DomainReference_authorId_idx" ON "DomainReference"("authorId");

-- AddForeignKey
ALTER TABLE "CritSubmission" ADD CONSTRAINT "CritSubmission_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CritSubmission" ADD CONSTRAINT "CritSubmission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainReference" ADD CONSTRAINT "DomainReference_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainReference" ADD CONSTRAINT "DomainReference_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

