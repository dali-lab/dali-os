-- AlterTable
ALTER TABLE "MentorshipPair" ADD COLUMN     "isExternal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StagedMentorshipPair" ADD COLUMN     "isExternal" BOOLEAN NOT NULL DEFAULT false;
