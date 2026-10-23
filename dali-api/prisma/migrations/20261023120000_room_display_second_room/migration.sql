-- AlterTable
ALTER TABLE "RoomDisplay" ADD COLUMN     "secondRoomId" TEXT;

-- CreateIndex
CREATE INDEX "RoomDisplay_secondRoomId_idx" ON "RoomDisplay"("secondRoomId");

-- AddForeignKey
ALTER TABLE "RoomDisplay" ADD CONSTRAINT "RoomDisplay_secondRoomId_fkey" FOREIGN KEY ("secondRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
