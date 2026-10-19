-- CreateEnum
CREATE TYPE "GoogleEventOrigin" AS ENUM ('Created', 'Tracked');

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "googleEventOrigin" "GoogleEventOrigin";
