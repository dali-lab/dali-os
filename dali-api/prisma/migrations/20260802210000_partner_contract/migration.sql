-- Partner contract step: after the SOW is iterated, Core drafts a contract
-- (its own collab doc), sets a free-text fee, and sends it; the applicant signs
-- with a typed-name affirmation. Legal identity reuses legalEntityName/Address
-- on the same row. Isolated from the app-gated member e-sign service.
ALTER TABLE "PartnerApplication" ADD COLUMN "contractDocId" TEXT;
ALTER TABLE "PartnerApplication" ADD COLUMN "contractFee" TEXT;
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSentAt" TIMESTAMP(3);
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSignedAt" TIMESTAMP(3);
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSignerName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_contractDocId_key" ON "PartnerApplication"("contractDocId");
