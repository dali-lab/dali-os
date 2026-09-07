-- Backfill ProcessFolderBinding rows pointing at the EXISTING systemKey folders,
-- and Project.publicWriteupPageId at the existing write-up pages. This bridges
-- the old systemKey scaffolding to the new binding framework: after this runs,
-- both systems reference the SAME folders, so the converted ensure* helpers
-- (which look up the binding first) reuse existing folders instead of creating
-- duplicates. systemKey is intentionally NOT cleared here — that happens in the
-- later removal migration once the old code paths are gone.

-- Project meeting-notes folders → Project bindings (processId = the project id,
-- which is the page's workspaceId for a Project-workspace folder).
INSERT INTO "ProcessFolderBinding" ("id", "processType", "processId", "purpose", "folderPageId", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Project', p."workspaceId", 'meeting-notes-team', p."id", p."createdById", now(), now()
FROM "Page" p
WHERE p."systemKey" LIKE 'project:%:team-meeting-notes' AND p."workspaceId" IS NOT NULL
ON CONFLICT ("processType", "processId", "purpose") DO NOTHING;

INSERT INTO "ProcessFolderBinding" ("id", "processType", "processId", "purpose", "folderPageId", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Project', p."workspaceId", 'meeting-notes-partner', p."id", p."createdById", now(), now()
FROM "Page" p
WHERE p."systemKey" LIKE 'project:%:partner-meeting-notes' AND p."workspaceId" IS NOT NULL
ON CONFLICT ("processType", "processId", "purpose") DO NOTHING;

-- Education offering Forms folders → EducationOffering bindings.
INSERT INTO "ProcessFolderBinding" ("id", "processType", "processId", "purpose", "folderPageId", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'EducationOffering', p."workspaceId", 'forms', p."id", p."createdById", now(), now()
FROM "Page" p
WHERE p."systemKey" LIKE 'education:%:forms-folder' AND p."workspaceId" IS NOT NULL
ON CONFLICT ("processType", "processId", "purpose") DO NOTHING;

-- Core / lab-wide governance singletons → Core bindings (processId = 'core').
INSERT INTO "ProcessFolderBinding" ("id", "processType", "processId", "purpose", "folderPageId", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Core', 'core', v.purpose, p."id", p."createdById", now(), now()
FROM (VALUES
  ('drive:core-agreements', 'agreements'),
  ('drive:core-templates', 'email-templates'),
  ('drive:core-templates-education', 'education-templates'),
  ('drive:hiring-rubrics', 'rubrics'),
  ('drive:hiring-templates', 'application-templates')
) AS v(system_key, purpose)
JOIN "Page" p ON p."systemKey" = v.system_key
ON CONFLICT ("processType", "processId", "purpose") DO NOTHING;

-- Project public write-up pages → Project.publicWriteupPageId (single-artifact FK).
UPDATE "Project" pr
SET "publicWriteupPageId" = p."id"
FROM "Page" p
WHERE p."systemKey" = 'project:' || pr."id" || ':public-writeup'
  AND pr."publicWriteupPageId" IS NULL;
