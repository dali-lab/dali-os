-- AlterTable
ALTER TABLE "EducationSession" ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "studentEditable" BOOLEAN NOT NULL DEFAULT false;
