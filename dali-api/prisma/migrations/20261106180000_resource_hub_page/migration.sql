-- CreateTable
CREATE TABLE "ResourceHubPage" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "contentJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceHubPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceHubPage_domainId_key" ON "ResourceHubPage"("domainId");

-- AddForeignKey
ALTER TABLE "ResourceHubPage" ADD CONSTRAINT "ResourceHubPage_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
