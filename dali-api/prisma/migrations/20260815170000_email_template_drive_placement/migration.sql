-- Unified-Drive tree placement for EmailTemplates, so hiring email templates
-- can live in the Hiring drive alongside the forms and rubrics they support.
-- Additive + nullable — organisation only, no access change.
ALTER TABLE "EmailTemplate" ADD COLUMN "folderPageId" TEXT;

CREATE INDEX "EmailTemplate_folderPageId_idx" ON "EmailTemplate"("folderPageId");
