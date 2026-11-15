-- DropIndex
DROP INDEX "ResourceHubPage_domainId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ResourceHubPage_domainId_key" ON "ResourceHubPage"("domainId");
