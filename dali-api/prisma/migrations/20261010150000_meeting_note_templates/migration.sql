-- Meeting notes model (specs/meeting-notes-model.md, PR 1): template pages
-- seeded into new meeting notes. Fully additive — three nullable columns and
-- one partial-safe unique index (Postgres treats NULLs as distinct, so this
-- only constrains the pages that actually opt in as a lab default).
--
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "meetingNoteTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "defaultMeetingNoteFor" "MeetingType",
ADD COLUMN     "seededFromPageId" TEXT,
ADD COLUMN     "seededTemplateHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Page_defaultMeetingNoteFor_key" ON "Page"("defaultMeetingNoteFor");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_meetingNoteTemplateId_fkey" FOREIGN KEY ("meetingNoteTemplateId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
