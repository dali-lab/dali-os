-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "notifyOnSubmission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "oneResponsePerMember" BOOLEAN NOT NULL DEFAULT false;
