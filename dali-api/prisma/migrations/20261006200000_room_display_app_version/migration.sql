-- Door displays report their app build on each poll so Core ▸ Rooms can tell
-- which iPads are behind. Additive and nullable.

-- AlterTable
ALTER TABLE "RoomDisplay" ADD COLUMN "appVersion" TEXT;
