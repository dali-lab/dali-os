-- Retire the legacy "Core" drive shell, so the Core space stops containing
-- itself.
--
-- The old ensureCoreDriveRoot created a Lab-root folder literally titled
-- "Core", scoped to the Core group, and hung every Core folder underneath it.
-- The systemKey removal (20260911170000) stripped the marker but left the
-- folder in place. The Core drive space is now a virtual filter — "every Lab
-- folder shared with the Core group is a top-level item" — and the leftover
-- shell matches that filter, so it renders as a child of itself:
-- Core ▸ Core ▸ {Templates, Agreements, …}. Everything real sits one level
-- deeper than it should.
--
-- This lifts the shell's children to the Lab root, carries the Core-group
-- scope onto each so they stay Core-only once their parent is gone, and
-- archives the empty shell.
--
-- Data-only; no schema change, so no drift.

-- The shell is found through a binding rather than its title: the backfill
-- (20260906020000) pointed Core's "agreements" slot at a folder that was a
-- direct child of the shell, so the shell is that folder's parent. Guarded on
-- the exact shape ensureCoreDriveRoot produced — a Lab-root, Core-group-scoped
-- Folder — so a repointed binding or an already-flattened database is a no-op.
CREATE TEMPORARY TABLE "_core_shell" AS
SELECT shell."id"
FROM "ProcessFolderBinding" b
JOIN "Page" child ON child."id" = b."folderPageId"
JOIN "Page" shell ON shell."id" = child."parentPageId"
WHERE b."processType" = 'Core'
  AND b."processId" = 'core'
  AND b."purpose" = 'agreements'
  AND shell."workspaceType" = 'Lab'
  AND shell."workspaceId" IS NULL
  AND shell."parentPageId" IS NULL
  AND shell."kind" = 'Folder'
  AND shell."scopeKind" = 'Group'
  AND shell."archivedAt" IS NULL;

-- 1. Carry the shell's access down to each child before detaching it. Without
--    this, a child that inherited Core-only access purely by sitting inside
--    the shell would land on the open Lab shelf. Folders take the governing
--    group scope (the ancestry walk in getPageAccess reads scopeKind); any
--    non-folder child just goes Restricted, which on a Lab page leaves Core
--    and the creator, matching what it had.
UPDATE "Page" c
SET "scopeKind"       = shell."scopeKind",
    "scopeGroupId"    = shell."scopeGroupId",
    "scopePermission" = COALESCE(shell."scopePermission", 'Edit'),
    "linkAccess"      = 'Restricted',
    "linkPermission"  = 'View'
FROM "Page" shell
WHERE shell."id" IN (SELECT "id" FROM "_core_shell")
  AND c."parentPageId" = shell."id"
  AND c."archivedAt" IS NULL
  AND c."kind" = 'Folder'
  -- Leave a child someone deliberately scoped for themselves alone.
  AND c."scopeKind" IS NULL;

UPDATE "Page" c
SET "linkAccess" = 'Restricted',
    "linkPermission" = 'View'
WHERE c."parentPageId" IN (SELECT "id" FROM "_core_shell")
  AND c."archivedAt" IS NULL
  AND c."kind" <> 'Folder'
  AND c."scopeKind" IS NULL;

-- 2. Lift the children to the Lab root, appended after whatever is already
--    there so the existing top-level order is undisturbed.
UPDATE "Page" c
SET "parentPageId" = NULL,
    "position" = (
      SELECT COALESCE(MAX(p."position"), -1)
      FROM "Page" p
      WHERE p."workspaceType" = 'Lab' AND p."workspaceId" IS NULL AND p."parentPageId" IS NULL
    ) + c."position" + 1
WHERE c."parentPageId" IN (SELECT "id" FROM "_core_shell")
  AND c."archivedAt" IS NULL;

-- 3. Archive the shell. Soft, like every other Drive delete, so it can be
--    restored from Trash if this turns out to have been wrong. Archived
--    children (already in Trash) keep pointing at it, which is what restoring
--    one of them expects.
UPDATE "Page"
SET "archivedAt" = now()
WHERE "id" IN (SELECT "id" FROM "_core_shell");

-- 4. A binding must never point at the archived shell. None did when this was
--    written (the Core slots point at its children), but a slot repointed at
--    the shell itself would otherwise be left dangling at a trashed folder;
--    clearing it lets ensureProcessFolder provision a fresh one.
UPDATE "ProcessFolderBinding"
SET "folderPageId" = NULL
WHERE "folderPageId" IN (SELECT "id" FROM "_core_shell");

DROP TABLE "_core_shell";
