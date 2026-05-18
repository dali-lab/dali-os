/*
  Warnings:

  - You are about to drop the `StaffingForm` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StaffingFormSubmission` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StaffingFormVersion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "StaffingFormSubmission" DROP CONSTRAINT "StaffingFormSubmission_formVersionId_fkey";

-- DropForeignKey
ALTER TABLE "StaffingFormSubmission" DROP CONSTRAINT "StaffingFormSubmission_staffingCycleId_fkey";

-- DropForeignKey
ALTER TABLE "StaffingFormSubmission" DROP CONSTRAINT "StaffingFormSubmission_userId_fkey";

-- DropForeignKey
ALTER TABLE "StaffingFormVersion" DROP CONSTRAINT "StaffingFormVersion_createdById_fkey";

-- DropForeignKey
ALTER TABLE "StaffingFormVersion" DROP CONSTRAINT "StaffingFormVersion_formId_fkey";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "isTodo" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "StaffingForm";

-- DropTable
DROP TABLE "StaffingFormSubmission";

-- DropTable
DROP TABLE "StaffingFormVersion";

-- DropEnum
DROP TYPE "StaffingFormKind";

-- CreateTable
CREATE TABLE "FormFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "FormFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "folderId" TEXT,
    "createdById" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publicToken" TEXT,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionNumber" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "intro" TEXT,
    "formId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "FormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "userId" TEXT,
    "submitterName" TEXT,
    "submitterEmail" TEXT,
    "answers" JSONB NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormFolder_parentId_idx" ON "FormFolder"("parentId");

-- CreateIndex
CREATE INDEX "FormFolder_createdById_idx" ON "FormFolder"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Form_publicToken_key" ON "Form"("publicToken");

-- CreateIndex
CREATE INDEX "Form_folderId_idx" ON "Form"("folderId");

-- CreateIndex
CREATE INDEX "Form_createdById_idx" ON "Form"("createdById");

-- CreateIndex
CREATE INDEX "FormVersion_formId_versionNumber_idx" ON "FormVersion"("formId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FormVersion_formId_versionNumber_key" ON "FormVersion"("formId", "versionNumber");

-- CreateIndex
CREATE INDEX "FormSubmission_userId_formVersionId_idx" ON "FormSubmission"("userId", "formVersionId");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_idx" ON "FormSubmission"("formId");

-- CreateIndex
CREATE INDEX "FormSubmission_formVersionId_idx" ON "FormSubmission"("formVersionId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFolder" ADD CONSTRAINT "FormFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FormFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFolder" ADD CONSTRAINT "FormFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "FormFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
