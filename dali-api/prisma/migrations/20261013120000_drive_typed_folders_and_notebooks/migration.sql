-- Drive phase 1a: typed folders, first-class notebooks, stable template keys.
-- Additive only. No roots are created here and no filer reads these columns
-- yet (specs/drive-and-meeting-notes-review.md, sections A, B, B2).

-- CreateEnum
CREATE TYPE "FolderType" AS ENUM ('Root', 'Meetings', 'HiringForms', 'ApplicationTemplates', 'Agreements', 'EducationTemplates', 'CertificateBackgrounds', 'MentorNotebooks');

-- AlterEnum
ALTER TYPE "PageKind" ADD VALUE 'Notebook';

-- AlterEnum
ALTER TYPE "ProcessType" ADD VALUE 'Mentorship';

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "templateKey" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "folderType" "FolderType",
ADD COLUMN     "processId" TEXT,
ADD COLUMN     "processType" "ProcessType";

-- AlterTable
ALTER TABLE "ScheduledMeeting" ADD COLUMN     "notebookId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Form_templateKey_key" ON "Form"("templateKey");

-- CreateIndex
CREATE INDEX "ScheduledMeeting_notebookId_idx" ON "ScheduledMeeting"("notebookId");

-- AddForeignKey
ALTER TABLE "ScheduledMeeting" ADD CONSTRAINT "ScheduledMeeting_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One live root or receiver per process. Prisma can't express a partial
-- index, so it lives here in raw SQL (same approach as
-- MeetingRecording_activeDocument_key). Nothing sets folderType yet, so it
-- cannot conflict with existing rows.
CREATE UNIQUE INDEX "Page_process_folder_type_live"
  ON "Page" ("processType", "processId", "folderType")
  WHERE "archivedAt" IS NULL AND "folderType" IS NOT NULL;
