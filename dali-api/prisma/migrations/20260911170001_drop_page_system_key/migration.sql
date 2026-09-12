-- Retire the Page.systemKey Drive-scaffolding column for good.
--
-- By this point systemKey is dead: 20260906030000 cleared it to NULL on every
-- drive folder, auto-filing routes through ProcessFolderBinding /
-- Project.publicWriteupPageId, and no application code reads or writes the
-- column any more (the move/archive/delete guards and the "Managed" chip that
-- keyed off it are gone). Drop the column and its unique index.
--
-- DATA-LOSING: drops the `Page.systemKey` column. Safe because the column is
-- all-NULL after the prior removal migration and nothing depends on it.
DROP INDEX IF EXISTS "Page_systemKey_key";
ALTER TABLE "Page" DROP COLUMN IF EXISTS "systemKey";
