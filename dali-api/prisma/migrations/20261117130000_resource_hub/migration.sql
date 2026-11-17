-- CreateTable
CREATE TABLE "ResourceHubPage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled hub',
    "coverUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "contentJson" JSONB,
    "domainId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ResourceHubPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceHubPage_domainId_key" ON "ResourceHubPage"("domainId");

-- CreateIndex
CREATE INDEX "ResourceHubPage_createdById_idx" ON "ResourceHubPage"("createdById");

-- AddForeignKey
ALTER TABLE "ResourceHubPage" ADD CONSTRAINT "ResourceHubPage_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceHubPage" ADD CONSTRAINT "ResourceHubPage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
