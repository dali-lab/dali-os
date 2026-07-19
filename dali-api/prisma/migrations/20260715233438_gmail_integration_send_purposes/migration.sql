-- CreateEnum
CREATE TYPE "EmailSendPurpose" AS ENUM ('Hiring', 'Education', 'Partners', 'General');

-- DropIndex
DROP INDEX "GmailIntegration_userId_key";

-- AlterTable
ALTER TABLE "GmailIntegration" ADD COLUMN     "purpose" "EmailSendPurpose" NOT NULL DEFAULT 'Hiring';

-- CreateIndex
CREATE UNIQUE INDEX "GmailIntegration_userId_purpose_key" ON "GmailIntegration"("userId", "purpose");

