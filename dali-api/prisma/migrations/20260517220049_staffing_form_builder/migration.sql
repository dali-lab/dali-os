-- CreateEnum
CREATE TYPE "StaffingFormKind" AS ENUM ('IntentToWork', 'ProjectBids');

-- CreateTable
CREATE TABLE "StaffingForm" (
    "id" TEXT NOT NULL,
    "kind" "StaffingFormKind" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingFormVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionNumber" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "intro" TEXT,
    "formId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "StaffingFormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingFormSubmission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,

    CONSTRAINT "StaffingFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffingForm_kind_key" ON "StaffingForm"("kind");

-- CreateIndex
CREATE INDEX "StaffingFormVersion_formId_versionNumber_idx" ON "StaffingFormVersion"("formId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingFormVersion_formId_versionNumber_key" ON "StaffingFormVersion"("formId", "versionNumber");

-- CreateIndex
CREATE INDEX "StaffingFormSubmission_formVersionId_staffingCycleId_idx" ON "StaffingFormSubmission"("formVersionId", "staffingCycleId");

-- CreateIndex
CREATE INDEX "StaffingFormSubmission_staffingCycleId_idx" ON "StaffingFormSubmission"("staffingCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingFormSubmission_userId_formVersionId_staffingCycleId_key" ON "StaffingFormSubmission"("userId", "formVersionId", "staffingCycleId");

-- AddForeignKey
ALTER TABLE "StaffingFormVersion" ADD CONSTRAINT "StaffingFormVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "StaffingForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingFormVersion" ADD CONSTRAINT "StaffingFormVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingFormSubmission" ADD CONSTRAINT "StaffingFormSubmission_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "StaffingFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingFormSubmission" ADD CONSTRAINT "StaffingFormSubmission_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingFormSubmission" ADD CONSTRAINT "StaffingFormSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
