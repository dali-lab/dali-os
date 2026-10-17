-- AlterTable
ALTER TABLE "UserFavorite" ADD COLUMN     "position" INTEGER;

-- Backfill: keep today's display order (route favorites first, then pages, each newest first).
UPDATE "UserFavorite" AS f
SET "position" = ranked.pos
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "userId"
           ORDER BY ("href" IS NULL), "favoritedAt" DESC
         ) - 1 AS pos
  FROM "UserFavorite"
  WHERE "favoritedAt" IS NOT NULL
) AS ranked
WHERE f."id" = ranked."id";

-- CreateIndex
CREATE INDEX "UserFavorite_userId_position_idx" ON "UserFavorite"("userId", "position");
