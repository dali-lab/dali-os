-- AlterTable
ALTER TABLE "MentorshipWarning" ADD COLUMN     "investigatorId" TEXT,
ADD COLUMN     "linkUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "meeting1Notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "meeting1On" DATE,
ADD COLUMN     "meeting2Notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "meeting2On" DATE,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "willAcceptReapp" BOOLEAN;

-- AddForeignKey
ALTER TABLE "MentorshipWarning" ADD CONSTRAINT "MentorshipWarning_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
