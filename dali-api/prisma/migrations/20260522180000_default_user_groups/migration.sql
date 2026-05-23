-- Default, system-managed user groups: one dynamic group per Term, Project,
-- and Domain, plus a single "Core" group. systemKey marks them so they can
-- be located on backfill and protected from manual edits/deletes.

ALTER TABLE "GroupDefinition" ADD COLUMN "systemKey" TEXT;
CREATE UNIQUE INDEX "GroupDefinition_systemKey_key" ON "GroupDefinition"("systemKey");

-- Backfill one Dynamic group per Term.
INSERT INTO "GroupDefinition" ("id", "name", "type", "dynamicQuery", "staticMemberIds", "systemKey", "createdAt")
SELECT
    'grp_term_' || t."id",
    'Term ' || t."code",
    'Dynamic',
    'term:' || t."id",
    ARRAY[]::text[],
    'term:' || t."id",
    CURRENT_TIMESTAMP
FROM "Term" t
ON CONFLICT ("systemKey") DO NOTHING;

-- Backfill one Dynamic group per Project.
INSERT INTO "GroupDefinition" ("id", "name", "type", "dynamicQuery", "staticMemberIds", "systemKey", "createdAt")
SELECT
    'grp_project_' || p."id",
    'Project ' || p."name",
    'Dynamic',
    'project:' || p."id",
    ARRAY[]::text[],
    'project:' || p."id",
    CURRENT_TIMESTAMP
FROM "Project" p
ON CONFLICT ("systemKey") DO NOTHING;

-- Backfill one Dynamic group per Domain.
INSERT INTO "GroupDefinition" ("id", "name", "type", "dynamicQuery", "staticMemberIds", "systemKey", "createdAt")
SELECT
    'grp_domain_' || d."id",
    'Domain ' || d."displayName",
    'Dynamic',
    'domain:' || d."id",
    ARRAY[]::text[],
    'domain:' || d."id",
    CURRENT_TIMESTAMP
FROM "Domain" d
ON CONFLICT ("systemKey") DO NOTHING;

-- Singleton Core group, resolved at query time to current-term Core members.
INSERT INTO "GroupDefinition" ("id", "name", "type", "dynamicQuery", "staticMemberIds", "systemKey", "createdAt")
VALUES (
    'grp_core',
    'Core',
    'Dynamic',
    'core',
    ARRAY[]::text[],
    'core',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("systemKey") DO NOTHING;
