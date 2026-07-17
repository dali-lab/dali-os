-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('Roster', 'SelfCheckIn');

-- AlterEnum
ALTER TYPE "TimeEntrySource" ADD VALUE 'Block';

-- AlterTable
ALTER TABLE "ManualBlock" ADD COLUMN     "assignmentType" "AssignmentType",
ADD COLUMN     "isWork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roleRefId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "attendanceMode" "AttendanceMode" NOT NULL DEFAULT 'Roster',
ADD COLUMN     "checkInToken" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "assignmentType" "AssignmentType",
ADD COLUMN     "manualBlockId" TEXT,
ADD COLUMN     "roleRefId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledMeeting_checkInToken_key" ON "ScheduledMeeting"("checkInToken");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_assignmentType_idx" ON "TimeEntry"("userId", "assignmentType");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_manualBlockId_userId_key" ON "TimeEntry"("manualBlockId", "userId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_manualBlockId_fkey" FOREIGN KEY ("manualBlockId") REFERENCES "ManualBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
