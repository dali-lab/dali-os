-- A new enum value can't be used in the transaction that adds it, so the
-- backfill of existing offering Forms folders is its own migration.
UPDATE "Page"
SET "folderType" = 'OfferingForms'
WHERE "kind" = 'Folder'
  AND "workspaceType" = 'EducationOffering'
  AND "parentPageId" IS NULL
  AND "title" = 'Forms'
  AND "archivedAt" IS NULL
  AND "folderType" IS NULL;
