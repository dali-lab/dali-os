-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "confirmationMessage" TEXT,
ADD COLUMN     "sendReceipt" BOOLEAN NOT NULL DEFAULT false;
