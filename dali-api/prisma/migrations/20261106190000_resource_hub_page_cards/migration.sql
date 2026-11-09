-- DropForeignKey
ALTER TABLE "ResourceHubPage" DROP CONSTRAINT "ResourceHubPage_domainId_fkey";

-- DropIndex
DROP INDEX "ResourceHubPage_domainId_key";

-- AlterTable
ALTER TABLE "ResourceHubPage" ADD COLUMN     "bgColor" TEXT,
ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Untitled hub',
ALTER COLUMN "domainId" DROP NOT NULL;

-- Pages made under the one-per-domain draft keep their domain's name.
UPDATE "ResourceHubPage" p SET "title" = d."displayName" FROM "Domain" d WHERE d."id" = p."domainId";

-- CreateIndex
CREATE INDEX "ResourceHubPage_domainId_idx" ON "ResourceHubPage"("domainId");

-- CreateIndex
CREATE INDEX "ResourceHubPage_createdById_idx" ON "ResourceHubPage"("createdById");

-- AddForeignKey
ALTER TABLE "ResourceHubPage" ADD CONSTRAINT "ResourceHubPage_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceHubPage" ADD CONSTRAINT "ResourceHubPage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
