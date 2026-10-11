-- Meeting notebooks: one Drive document per run of meeting notes, with each
-- note a child page shown as a side tab. Additive and nullable, so existing
-- pages are untouched; scripts/backfill-meeting-notebooks.ts files the notes
-- that already exist.

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "notebookKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Page_notebookKey_key" ON "Page"("notebookKey");
