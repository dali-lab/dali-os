-- The public project write-up moves from a free-text collab document to
-- structured { item, description } pairs (details), plus an image/video gallery
-- (media). Both additive nullable JSONB — no backfill in-migration; a separate
-- script seeds details from the old write-up docs, and the public API falls
-- back to the default three pairs when details is null.

-- AlterTable
ALTER TABLE "ProjectShowcase" ADD COLUMN     "details" JSONB,
ADD COLUMN     "media" JSONB;
