-- CreateEnum
CREATE TYPE "InterviewLocation" AS ENUM ('PodAppa', 'PodMomo', 'Online');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "location" "InterviewLocation" NOT NULL DEFAULT 'Online';
