-- AlterTable
ALTER TABLE "GalleryPost" ADD COLUMN     "feedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "takenAt" TIMESTAMP(3);

-- Existing posts sort where they always have.
UPDATE "GalleryPost" SET "feedAt" = "createdAt";
