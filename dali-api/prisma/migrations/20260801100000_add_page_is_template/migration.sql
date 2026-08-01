-- Add isTemplate flag to Page.
-- NOT NULL with DEFAULT false — safe on populated tables; no data loss.
ALTER TABLE "Page" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
