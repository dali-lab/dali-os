-- Per-user page state: favourites and last-visited, feeding the home
-- Favourites panel. One row per (user, page), upserted on favourite or open,
-- so this stays bounded by people × pages-they've-touched rather than growing
-- per visit like an event log.
--
-- Distinct from Page.pinnedAt (one shared pin on a project's Documents block)
-- and from PageView (analytics, which normalizes record ids out of the path
-- and so cannot say which page was opened).
CREATE TABLE "UserPage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "favoritedAt" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),

    CONSTRAINT "UserPage_pkey" PRIMARY KEY ("id")
);

-- Upsert target.
CREATE UNIQUE INDEX "UserPage_userId_pageId_key" ON "UserPage"("userId", "pageId");

-- The panel's two reads: this user's pins, and this user's recents.
CREATE INDEX "UserPage_userId_favoritedAt_idx" ON "UserPage"("userId", "favoritedAt");
CREATE INDEX "UserPage_userId_visitedAt_idx" ON "UserPage"("userId", "visitedAt");

-- Cascade both ways: a deleted page or user leaves no orphaned state.
ALTER TABLE "UserPage" ADD CONSTRAINT "UserPage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPage" ADD CONSTRAINT "UserPage_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
