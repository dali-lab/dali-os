-- Final removal: the systemKey drive scaffolding is gone from the code (no more
-- ensureCoreDriveRoot / ensureHiringDriveRoot / adopt*). This migration moves the
-- old Hiring drive tree into a dedicated Core-only Hiring drive space (via the
-- HiringCycle/'hiring' singleton bindings) and strips the systemKey marker off
-- every drive folder so they behave as ordinary, editable folders. Runs after the
-- additive binding backfill (20260906020000).

-- 1. Move the old Hiring drive tree into a dedicated, Core-only Hiring drive
--    space (parallel to Core, not folded into it). Re-scope the old Hiring root
--    AND its artifact folders to the Core group so nothing leaks lab-wide once
--    the systemKey markers are stripped (step 2). Access stays Core-only, which
--    covers every lead/domain lead. No-op if the Core group isn't seeded.
UPDATE "Page"
SET "scopeKind" = 'Group',
    "scopeGroupId" = (SELECT "id" FROM "GroupDefinition" WHERE "systemKey" = 'core'),
    "scopePermission" = 'Edit',
    "linkAccess" = 'Restricted'
WHERE "systemKey" IN ('drive:hiring-root', 'drive:hiring-templates', 'drive:hiring-rubrics')
  AND EXISTS (SELECT 1 FROM "GroupDefinition" WHERE "systemKey" = 'core');

-- Bind the old Hiring root as the Hiring singleton's "hiring-forms" folder so new
-- challenge/application forms file there (HiringCycle / 'hiring', not per cycle).
INSERT INTO "ProcessFolderBinding" ("id", "processType", "processId", "purpose", "folderPageId", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'HiringCycle', 'hiring', 'hiring-forms', p."id", p."createdById", now(), now()
FROM "Page" p
WHERE p."systemKey" = 'drive:hiring-root'
ON CONFLICT ("processType", "processId", "purpose") DO NOTHING;

-- Re-home the application-templates + rubrics bindings the additive backfill
-- (20260906020000) seeded under the Core singleton onto the Hiring singleton, so
-- all hiring artifacts share one user-configurable Hiring folder set. The folders
-- themselves are unchanged (just re-scoped above); only the binding owner moves.
UPDATE "ProcessFolderBinding"
SET "processType" = 'HiringCycle', "processId" = 'hiring'
WHERE "processType" = 'Core' AND "processId" = 'core'
  AND "purpose" IN ('application-templates', 'rubrics');

-- 2. Strip the systemKey marker from every drive folder (and the public write-up
--    page). Done last so the lookups above still work. After this, no Page is
--    system-managed; access rides on scopeKind + the bindings.
UPDATE "Page"
SET "systemKey" = NULL
WHERE "systemKey" IN (
    'drive:core-root',
    'drive:core-templates',
    'drive:core-templates-hiring',
    'drive:core-templates-education',
    'drive:core-agreements',
    'drive:core-rubrics',
    'drive:hiring-root',
    'drive:hiring-rubrics',
    'drive:hiring-templates'
  )
  OR "systemKey" LIKE 'project:%:team-meeting-notes'
  OR "systemKey" LIKE 'project:%:partner-meeting-notes'
  OR "systemKey" LIKE 'education:%:forms-folder'
  OR "systemKey" LIKE 'project:%:public-writeup';
