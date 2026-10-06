-- AlterTable
ALTER TABLE "GmailIntegration" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
