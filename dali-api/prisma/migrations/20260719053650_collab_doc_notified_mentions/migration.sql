-- AlterTable
ALTER TABLE "CollabDocument" ADD COLUMN     "notifiedMentionUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
