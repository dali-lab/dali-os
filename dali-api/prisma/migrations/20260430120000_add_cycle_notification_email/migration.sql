-- Add the per-cycle binding for non-decision notification emails
-- (ApplicationReceived, InterviewInviteMentor). Mirrors CycleDecisionEmail
-- with no lock-on-release concept — slots can be rebound any time.

-- ── 1. NotificationType enum ──────────────────────────────────────────────────
CREATE TYPE "NotificationType" AS ENUM ('ApplicationReceived', 'InterviewInviteMentor');

-- ── 2. CycleNotificationEmail (per-cycle binding) ─────────────────────────────
CREATE TABLE "CycleNotificationEmail" (
    "applicationCycleId" TEXT NOT NULL,
    "notificationType" "NotificationType" NOT NULL,
    "emailTemplateVersionId" TEXT NOT NULL,

    CONSTRAINT "CycleNotificationEmail_pkey" PRIMARY KEY ("applicationCycleId", "notificationType")
);

-- ── 3. Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE "CycleNotificationEmail"
  ADD CONSTRAINT "CycleNotificationEmail_applicationCycleId_fkey"
  FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CycleNotificationEmail"
  ADD CONSTRAINT "CycleNotificationEmail_emailTemplateVersionId_fkey"
  FOREIGN KEY ("emailTemplateVersionId") REFERENCES "EmailTemplateVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 4. Backfill: parent EmailTemplate rows from legacy ApplicationReceived /
-- InterviewInviteMentor templates. Deterministic ID matches seed.ts so a
-- freshly-migrated DB plus a re-seed converge on the same row.
INSERT INTO "EmailTemplate" ("id", "createdAt", "updatedAt", "name")
SELECT DISTINCT
  'tmpl_' || lower(type::text),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  type::text
FROM "LegacyEmailTemplate"
WHERE type IN ('ApplicationReceived', 'InterviewInviteMentor')
ON CONFLICT ("id") DO NOTHING;

-- ── 5. Backfill: EmailTemplateVersion rows from each legacy notification row.
-- Reuse the legacy id so re-runs against a partially-migrated DB stay idempotent.
INSERT INTO "EmailTemplateVersion"
  ("id", "createdAt", "versionNumber", "subject", "body", "templateId", "createdById")
SELECT
  legacy."id",
  legacy."createdAt",
  legacy."version",
  legacy."subject",
  legacy."body",
  'tmpl_' || lower(legacy."type"::text),
  legacy."createdById"
FROM "LegacyEmailTemplate" legacy
WHERE legacy."type" IN ('ApplicationReceived', 'InterviewInviteMentor')
ON CONFLICT ("id") DO NOTHING;

-- ── 6. Backfill: bind every existing ApplicationCycle to the highest-version
-- template for each NotificationType. Legacy lookup wasn't cycle-scoped, so all
-- cycles inherit the same binding — preserves current send behavior for any
-- in-flight cycle. Cycles with no template available for a slot get no row
-- (the picker UI surfaces this as "no template assigned"), matching the
-- decision-email backfill pattern.
INSERT INTO "CycleNotificationEmail"
  ("applicationCycleId", "notificationType", "emailTemplateVersionId")
SELECT
  c."id",
  n.notification_type::"NotificationType",
  v.id
FROM "ApplicationCycle" c
CROSS JOIN (VALUES ('ApplicationReceived'), ('InterviewInviteMentor')) AS n(notification_type)
JOIN LATERAL (
  SELECT etv."id"
  FROM "EmailTemplateVersion" etv
  JOIN "EmailTemplate" et ON et."id" = etv."templateId"
  WHERE et."name" = n.notification_type
  ORDER BY etv."versionNumber" DESC
  LIMIT 1
) v ON TRUE
ON CONFLICT ("applicationCycleId", "notificationType") DO NOTHING;
