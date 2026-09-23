-- A meeting's optional linked whiteboard page, parallel to meetingNoteId. A
-- meeting can have a note doc and/or a whiteboard, each 1:1. Additive: a nullable
-- column, its unique index, and the FK — no rows are written, and the existing
-- meetingNoteId relation only gains a Prisma relation name (no DDL).

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "meetingWhiteboardId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Page_meetingWhiteboardId_key" ON "Page"("meetingWhiteboardId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_meetingWhiteboardId_fkey" FOREIGN KEY ("meetingWhiteboardId") REFERENCES "ScheduledMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
