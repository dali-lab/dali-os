-- CreateEnum
CREATE TYPE "MentorNoteVibe" AS ENUM ('Good', 'Ok', 'Bad');

-- AlterTable
ALTER TABLE "MentorNote" ADD COLUMN     "vibe" "MentorNoteVibe";
