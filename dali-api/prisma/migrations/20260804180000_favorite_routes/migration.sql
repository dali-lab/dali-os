-- Favourites now cover anywhere in the app, not just documents: a project hub
-- and a subtab are URLs, with no Page row to point at. Widen the table rather
-- than adding a second one, so the home panel stays one ordered read.
--
-- pageId becomes nullable (route favourites have none) and href/label carry the
-- destination. Exactly one of pageId/href is set; label is a snapshot of the
-- destination's name at the time it was starred.
ALTER TABLE "UserPage" RENAME TO "UserFavorite";

ALTER TABLE "UserFavorite" RENAME CONSTRAINT "UserPage_pkey" TO "UserFavorite_pkey";
ALTER TABLE "UserFavorite" RENAME CONSTRAINT "UserPage_userId_fkey" TO "UserFavorite_userId_fkey";
ALTER TABLE "UserFavorite" RENAME CONSTRAINT "UserPage_pageId_fkey" TO "UserFavorite_pageId_fkey";

ALTER INDEX "UserPage_userId_pageId_key" RENAME TO "UserFavorite_userId_pageId_key";
ALTER INDEX "UserPage_userId_favoritedAt_idx" RENAME TO "UserFavorite_userId_favoritedAt_idx";
ALTER INDEX "UserPage_userId_visitedAt_idx" RENAME TO "UserFavorite_userId_visitedAt_idx";

ALTER TABLE "UserFavorite" ALTER COLUMN "pageId" DROP NOT NULL;
ALTER TABLE "UserFavorite" ADD COLUMN "href" TEXT;
ALTER TABLE "UserFavorite" ADD COLUMN "label" TEXT;

-- Postgres treats NULLs as distinct, so this constrains route favourites only
-- and leaves the many page rows (href IS NULL) alone.
CREATE UNIQUE INDEX "UserFavorite_userId_href_key" ON "UserFavorite"("userId", "href");
