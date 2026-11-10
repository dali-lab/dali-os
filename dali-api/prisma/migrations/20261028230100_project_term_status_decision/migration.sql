-- AlterTable
ALTER TABLE "ProjectTermStatus" ADD COLUMN     "feeCents" INTEGER,
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "nextStepDueAt" TIMESTAMP(3),
ADD COLUMN     "reason" TEXT;
