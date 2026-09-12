-- Notion-style catalog icon for education offerings, shown on the catalog card
-- cover. Additive nullable column — no backfill, existing rows fall back to the
-- first-letter placeholder in the UI.

-- AlterTable
ALTER TABLE "EducationOffering" ADD COLUMN "iconEmoji" TEXT;
