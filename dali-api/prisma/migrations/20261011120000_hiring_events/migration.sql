-- Application events (help hours, socials, info sessions) on a hiring
-- cycle: two new tables (HiringEvent, HiringEventAttendance) plus the
-- NotificationType value the manual announcement-email slot needs to be
-- valid. Fully additive.

-- CreateEnum
CREATE TYPE "HiringEventKind" AS ENUM ('HelpHour', 'Social', 'InfoSession', 'Other');

-- AlterEnum
--
-- Postgres 16 allows ALTER TYPE ... ADD VALUE inside a transaction; the new
-- value just can't be *used* in that same transaction. Nothing below writes
-- a row with it, so this is safe as one migration.
ALTER TYPE "NotificationType" ADD VALUE 'ApplicationEventAnnouncement';

-- CreateTable
CREATE TABLE "HiringEvent" (
    "id" TEXT NOT NULL,
    "applicationCycleId" TEXT NOT NULL,
    "kind" "HiringEventKind" NOT NULL DEFAULT 'HelpHour',
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "checkInOpenAt" TIMESTAMP(3),
    "announcementSentAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringEventAttendance" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "markedByUserId" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringEventAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringEvent_applicationCycleId_startsAt_idx" ON "HiringEvent"("applicationCycleId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringEventAttendance_eventId_userId_key" ON "HiringEventAttendance"("eventId", "userId");

-- CreateIndex
CREATE INDEX "HiringEventAttendance_userId_idx" ON "HiringEventAttendance"("userId");

-- AddForeignKey
ALTER TABLE "HiringEvent" ADD CONSTRAINT "HiringEvent_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringEventAttendance" ADD CONSTRAINT "HiringEventAttendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HiringEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringEventAttendance" ADD CONSTRAINT "HiringEventAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
