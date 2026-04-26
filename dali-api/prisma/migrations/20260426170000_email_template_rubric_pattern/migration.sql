-- Email-template refactor to rubric/RubricVersion pattern.
-- See plan: dali-api EmailTemplate becomes a named, versioned object;
-- per-cycle bindings live in CycleDecisionEmail keyed on (cycle, DecisionType).
-- The pre-existing single-table EmailTemplate is renamed to EmailTemplateLegacy
-- and retained for ApplicationReceived / InterviewInviteMentor lookups, which
-- have not been migrated to the new shape.

-- ── 1. Rename the legacy table and its constraints ─────────────────────────────
ALTER TABLE "EmailTemplate" RENAME TO "EmailTemplateLegacy";
ALTER TABLE "EmailTemplateLegacy" RENAME CONSTRAINT "EmailTemplate_pkey" TO "EmailTemplateLegacy_pkey";
ALTER TABLE "EmailTemplateLegacy" RENAME CONSTRAINT "EmailTemplate_createdById_fkey" TO "EmailTemplateLegacy_createdById_fkey";
ALTER INDEX "EmailTemplate_type_createdAt_idx" RENAME TO "EmailTemplateLegacy_type_createdAt_idx";

-- ── 2. New EmailTemplate (named parent, like Rubric) ──────────────────────────
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- ── 3. EmailTemplateVersion (immutable snapshot, like RubricVersion) ──────────
CREATE TABLE "EmailTemplateVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionNumber" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "EmailTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailTemplateVersion_templateId_versionNumber_idx" ON "EmailTemplateVersion"("templateId", "versionNumber");

-- ── 4. CycleDecisionEmail (per-cycle binding) ─────────────────────────────────
CREATE TABLE "CycleDecisionEmail" (
    "applicationCycleId" TEXT NOT NULL,
    "decisionType" "DecisionType" NOT NULL,
    "emailTemplateVersionId" TEXT NOT NULL,

    CONSTRAINT "CycleDecisionEmail_pkey" PRIMARY KEY ("applicationCycleId", "decisionType")
);

-- ── 5. Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE "EmailTemplateVersion"
  ADD CONSTRAINT "EmailTemplateVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailTemplateVersion"
  ADD CONSTRAINT "EmailTemplateVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "DALIMember"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CycleDecisionEmail"
  ADD CONSTRAINT "CycleDecisionEmail_applicationCycleId_fkey"
  FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CycleDecisionEmail"
  ADD CONSTRAINT "CycleDecisionEmail_emailTemplateVersionId_fkey"
  FOREIGN KEY ("emailTemplateVersionId") REFERENCES "EmailTemplateVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 6. Backfill: parent rows ──────────────────────────────────────────────────
-- One EmailTemplate per legacy type. Deterministic ID so re-running this block
-- (e.g. against a partially-migrated DB) is idempotent via ON CONFLICT.
INSERT INTO "EmailTemplate" ("id", "createdAt", "updatedAt", "name")
SELECT DISTINCT
  'tmpl_' || lower(type::text),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  type::text
FROM "EmailTemplateLegacy"
ON CONFLICT ("id") DO NOTHING;

-- ── 7. Backfill: version rows ─────────────────────────────────────────────────
-- One EmailTemplateVersion per legacy row. Reuse the legacy id so back-pointers
-- from elsewhere (none today) would not break, and so re-runs are idempotent.
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
FROM "EmailTemplateLegacy" legacy
ON CONFLICT ("id") DO NOTHING;

-- ── 8. Backfill: per-cycle bindings for currently-active cycles ───────────────
-- For each cycle whose latest status update is in ('Open','UnderReview'),
-- bind each of the four DecisionType slots to the highest-versionNumber template
-- whose name equals the decision type. Cycles with no template for a slot get no
-- row (the picker UI surfaces this as "no template assigned").
INSERT INTO "CycleDecisionEmail"
  ("applicationCycleId", "decisionType", "emailTemplateVersionId")
SELECT
  active.cycle_id,
  d.decision_type::"DecisionType",
  v.id
FROM (
  SELECT DISTINCT ON (su."applicationCycleId")
    su."applicationCycleId" AS cycle_id,
    su."newStatus"          AS latest_status
  FROM "ApplicationCycleStatusUpdate" su
  ORDER BY su."applicationCycleId", su."createdAt" DESC
) active
CROSS JOIN (VALUES ('Rejected'), ('InvitedToInterview'), ('Accepted'), ('Waitlisted')) AS d(decision_type)
JOIN LATERAL (
  SELECT etv."id"
  FROM "EmailTemplateVersion" etv
  JOIN "EmailTemplate" et ON et."id" = etv."templateId"
  WHERE et."name" = d.decision_type
  ORDER BY etv."versionNumber" DESC
  LIMIT 1
) v ON TRUE
WHERE active.latest_status IN ('Open', 'UnderReview')
ON CONFLICT ("applicationCycleId", "decisionType") DO NOTHING;
