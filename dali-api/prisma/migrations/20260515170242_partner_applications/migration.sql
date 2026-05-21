-- CreateEnum
CREATE TYPE "PartnerApplicationStatus" AS ENUM ('Submitted', 'UnderReview', 'OnHold', 'Accepted', 'Rejected');

-- CreateTable
CREATE TABLE "PartnerApplication" (
    "id" TEXT NOT NULL,
    "partnerOrgId" TEXT NOT NULL,
    "targetTermId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sowDocId" TEXT,
    "status" "PartnerApplicationStatus" NOT NULL DEFAULT 'Submitted',
    "resultingProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerApplicationDomain" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "expectedChallenges" TEXT,
    "expectedMembers" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PartnerApplicationDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_sowDocId_key" ON "PartnerApplication"("sowDocId");

-- CreateIndex
CREATE INDEX "PartnerApplication_partnerOrgId_idx" ON "PartnerApplication"("partnerOrgId");

-- CreateIndex
CREATE INDEX "PartnerApplication_status_idx" ON "PartnerApplication"("status");

-- CreateIndex
CREATE INDEX "PartnerApplication_targetTermId_idx" ON "PartnerApplication"("targetTermId");

-- CreateIndex
CREATE INDEX "PartnerApplicationDomain_domainId_idx" ON "PartnerApplicationDomain"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplicationDomain_applicationId_domainId_key" ON "PartnerApplicationDomain"("applicationId", "domainId");

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "PartnerOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_targetTermId_fkey" FOREIGN KEY ("targetTermId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplicationDomain" ADD CONSTRAINT "PartnerApplicationDomain_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplicationDomain" ADD CONSTRAINT "PartnerApplicationDomain_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
