-- Bookings may now repeat, same shape as ScheduledMeeting's recurrence:
-- RoomBooking.recurrenceRule (RFC 5545 RRULE, start/end are the first
-- occurrence) plus RoomBookingException for per-occurrence overrides and
-- cancellations, mirroring MeetingException field-for-field.

-- AlterTable
ALTER TABLE "RoomBooking" ADD COLUMN "recurrenceRule" TEXT,
ADD COLUMN     "seriesEnd" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RoomBookingException" (
    "id" TEXT NOT NULL,
    "roomBookingId" TEXT NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "overrideStart" TIMESTAMP(3),
    "overrideDurationMin" INTEGER,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RoomBookingException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomBookingException_roomBookingId_originalStart_key" ON "RoomBookingException"("roomBookingId", "originalStart");

-- AddForeignKey
ALTER TABLE "RoomBookingException" ADD CONSTRAINT "RoomBookingException_roomBookingId_fkey" FOREIGN KEY ("roomBookingId") REFERENCES "RoomBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
