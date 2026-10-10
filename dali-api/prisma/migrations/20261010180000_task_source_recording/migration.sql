-- Meeting notes model (specs/meeting-notes-model.md, section 4): backlinks a
-- Task to the MeetingRecording whose action item created it, so "tasks from
-- this meeting" is a query and a re-run never creates a duplicate. Nullable,
-- additive; onDelete SET NULL so discarding the recording doesn't take the
-- task with it.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "sourceRecordingId" TEXT;

-- CreateIndex
CREATE INDEX "Task_sourceRecordingId_idx" ON "Task"("sourceRecordingId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceRecordingId_fkey" FOREIGN KEY ("sourceRecordingId") REFERENCES "MeetingRecording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
