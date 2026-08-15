-- Unified-Drive tree placement for Rubrics and Signing documents (agreements),
-- so hiring rubrics + confidentiality agreements can live in the Hiring drive
-- alongside the forms. Additive + nullable — organisation only, no access change.
ALTER TABLE "Rubric" ADD COLUMN "folderPageId" TEXT;
ALTER TABLE "SigningDocument" ADD COLUMN "folderPageId" TEXT;

CREATE INDEX "Rubric_folderPageId_idx" ON "Rubric"("folderPageId");
