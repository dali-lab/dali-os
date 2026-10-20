-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resumeFileName" TEXT,
ADD COLUMN     "resumeKey" TEXT,
ADD COLUMN     "resumeSizeBytes" INTEGER,
ADD COLUMN     "resumeUploadedAt" TIMESTAMP(3);
