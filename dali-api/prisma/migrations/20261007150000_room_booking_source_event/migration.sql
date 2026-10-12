-- A room booked from a plain calendar event's Location field remembers the
-- event, so deleting or moving the event frees or retimes the hold instead of
-- leaving it orphaned until the slot passes. Additive and nullable.

-- AlterTable
ALTER TABLE "RoomBooking" ADD COLUMN "sourceEventId" TEXT;

-- CreateIndex
CREATE INDEX "RoomBooking_userId_sourceEventId_idx" ON "RoomBooking"("userId", "sourceEventId");
