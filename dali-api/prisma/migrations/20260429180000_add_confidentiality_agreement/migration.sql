-- CreateTable
CREATE TABLE "ConfidentialityAgreement" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ConfidentialityAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidentialityAgreementVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionNumber" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "agreementId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ConfidentialityAgreementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleConfidentialityAgreement" (
    "applicationCycleId" TEXT NOT NULL,
    "confidentialityAgreementVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleConfidentialityAgreement_pkey" PRIMARY KEY ("applicationCycleId")
);

-- CreateTable
CREATE TABLE "ConfidentialityAgreementSignature" (
    "id" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "confidentialityAgreementVersionId" TEXT NOT NULL,

    CONSTRAINT "ConfidentialityAgreementSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfidentialityAgreementVersion_agreementId_versionNumber_idx" ON "ConfidentialityAgreementVersion"("agreementId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CycleConfidentialityAgreement_applicationCycleId_key" ON "CycleConfidentialityAgreement"("applicationCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfidentialityAgreementSignature_userId_applicationCycleId_key" ON "ConfidentialityAgreementSignature"("userId", "applicationCycleId");

-- CreateIndex
CREATE INDEX "ConfidentialityAgreementSignature_applicationCycleId_idx" ON "ConfidentialityAgreementSignature"("applicationCycleId");

-- AddForeignKey
ALTER TABLE "ConfidentialityAgreementVersion" ADD CONSTRAINT "ConfidentialityAgreementVersion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "ConfidentialityAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialityAgreementVersion" ADD CONSTRAINT "ConfidentialityAgreementVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleConfidentialityAgreement" ADD CONSTRAINT "CycleConfidentialityAgreement_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleConfidentialityAgreement" ADD CONSTRAINT "CycleConfidentialityAgreement_confidentialityAgreementVersionId_fkey" FOREIGN KEY ("confidentialityAgreementVersionId") REFERENCES "ConfidentialityAgreementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialityAgreementSignature" ADD CONSTRAINT "ConfidentialityAgreementSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialityAgreementSignature" ADD CONSTRAINT "ConfidentialityAgreementSignature_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialityAgreementSignature" ADD CONSTRAINT "ConfidentialityAgreementSignature_confidentialityAgreementVersionId_fkey" FOREIGN KEY ("confidentialityAgreementVersionId") REFERENCES "ConfidentialityAgreementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
