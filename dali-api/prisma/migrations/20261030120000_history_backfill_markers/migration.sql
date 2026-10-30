-- Marks Core history imported from payroll records, which must not count as public team membership.
ALTER TABLE "CoreAssignment" ADD COLUMN "backfilled" BOOLEAN NOT NULL DEFAULT false;

-- Holds pre-domain project history. Inactive and system, so no picker or staffing surface offers it.
INSERT INTO "Domain" ("id", "createdAt", "updatedAt", "name", "code", "displayName", "isInternProgram", "isSystem", "active")
VALUES ('domain_legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Legacy', 'Legacy', 'Legacy', false, true, false)
ON CONFLICT ("code") DO NOTHING;
