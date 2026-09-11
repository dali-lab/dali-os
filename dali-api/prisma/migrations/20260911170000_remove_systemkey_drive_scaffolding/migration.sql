-- Final removal: the systemKey drive scaffolding is gone from the code (no more
-- ensureCoreDriveRoot / ensureHiringDriveRoot / adopt*). This migration folds the
-- old Hiring space into Core and strips the systemKey marker off every drive
-- folder so they behave as ordinary, editable folders. Runs after the additive
-- binding backfill (20260906020000).

-- 1. Fold Hiring into Core: re-scope the old Hiring root to the Core group so its
--    subtree (rubrics, application templates, cycle forms) surfaces in the Core
--    space, and bind it as the Core "hiring-forms" folder so new hiring forms
--    file there. No-op if the Core group isn't seeded.
UPDATE "Page"
SET "scopeKind" = 'Group',
    "scopeGroupId" = (SELECT "id" FROM "GroupDefinition" WHERE "systemKey" = 'core'),
    "scopePermission" = 'Edit',
    "linkAccess" = 'Restricted'
WHERE "systemKey" = 'drive:hiring-root'
  AND EXISTS (SELECT 1 FROM "GroupDefinition" WHERE "systemKey" = 'core');

INSERT INTO "ProcessFolderBinding" ("id", "processType", "processId", "purpose", "folderPageId", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Core', 'core', 'hiring-forms', p."id", p."createdById", now(), now()
FROM "Page" p
WHERE p."systemKey" = 'drive:hiring-root'
ON CONFLICT ("processType", "processId", "purpose") DO NOTHING;

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
