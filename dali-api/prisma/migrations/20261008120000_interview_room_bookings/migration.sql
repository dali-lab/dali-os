-- Interviews book real rooms. Interview.location (PodAppa | PodMomo | Online)
-- becomes Interview.roomId → Room plus Interview.roomBookingId → RoomBooking,
-- so /rooms and the door displays see interviews and members can't book over
-- them. InterviewConfig picks which rooms a cycle interviews in and may hold
-- them for interview hours across the window.

-- AlterEnum
ALTER TYPE "RoomBookingSource" ADD VALUE 'Interview';
ALTER TYPE "RoomBookingSource" ADD VALUE 'InterviewHold';

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "roomBookingId" TEXT,
ADD COLUMN     "roomId" TEXT;

-- AlterTable
ALTER TABLE "InterviewConfig" ADD COLUMN     "holdRooms" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RoomBooking" ADD COLUMN     "applicationCycleId" TEXT;

-- CreateTable
CREATE TABLE "_InterviewConfigToRoom" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_InterviewConfigToRoom_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_InterviewConfigToRoom_B_index" ON "_InterviewConfigToRoom"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_roomBookingId_key" ON "Interview"("roomBookingId");

-- CreateIndex
CREATE INDEX "RoomBooking_applicationCycleId_source_idx" ON "RoomBooking"("applicationCycleId", "source");

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_roomBookingId_fkey" FOREIGN KEY ("roomBookingId") REFERENCES "RoomBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_applicationCycleId_fkey" FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InterviewConfigToRoom" ADD CONSTRAINT "_InterviewConfigToRoom_A_fkey" FOREIGN KEY ("A") REFERENCES "InterviewConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InterviewConfigToRoom" ADD CONSTRAINT "_InterviewConfigToRoom_B_fkey" FOREIGN KEY ("B") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: the two pods the enum named become Room rows (kept if an operator
-- already added them by name on /core/rooms).
INSERT INTO "Room" ("id", "name", "description", "capacity", "createdAt", "updatedAt")
SELECT 'room_pod_appa', 'Pod Appa', 'DALI Lab', 4, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE "name" = 'Pod Appa');

INSERT INTO "Room" ("id", "name", "description", "capacity", "createdAt", "updatedAt")
SELECT 'room_pod_momo', 'Pod Momo', 'DALI Lab', 4, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE "name" = 'Pod Momo');

-- Data: carry each interview's pod over to roomId. Historical rows get a
-- room but no booking; scripts/backfill-interview-room-bookings.ts holds
-- the room for future Scheduled ones.
UPDATE "Interview" i
SET "roomId" = r."id"
FROM "Room" r
WHERE (i."location" = 'PodAppa' AND r."name" = 'Pod Appa')
   OR (i."location" = 'PodMomo' AND r."name" = 'Pod Momo');

-- Data: every existing cycle interviewed in both pods.
INSERT INTO "_InterviewConfigToRoom" ("A", "B")
SELECT c."id", r."id"
FROM "InterviewConfig" c
CROSS JOIN "Room" r
WHERE r."name" IN ('Pod Appa', 'Pod Momo')
ON CONFLICT DO NOTHING;

-- AlterTable
ALTER TABLE "Interview" DROP COLUMN "location";

-- DropEnum
DROP TYPE "InterviewLocation";
