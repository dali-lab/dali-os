-- A form now keeps an editable working copy ("Save") separate from its frozen,
-- usable versions ("Save as version"). The draft is never served to fillers;
-- published fills always read the latest FormVersion. Both columns are
-- nullable and default to NULL (no draft), so existing forms are unaffected.

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "draftQuestions" JSONB,
ADD COLUMN     "draftIntro" TEXT;
