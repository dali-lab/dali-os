-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "continuesProjectId" TEXT;

-- CreateIndex
CREATE INDEX "PartnerApplication_continuesProjectId_idx" ON "PartnerApplication"("continuesProjectId");

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_continuesProjectId_fkey" FOREIGN KEY ("continuesProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
