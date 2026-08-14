-- Core hiring cycle + rename of the "InternToFull" internal cycle to "Fellowship",
-- and the move of the internal-cycle shortform onto the general Drive Forms
-- system (so hiring question-sets live in Drive like every other Form).
--
-- The enum-value renames and column rename are non-destructive. The shortform
-- conversion copies each existing InternToFullFormVersion row into a Form +
-- FormVersion, repoints the Fellowship cycles/applications at the new Form /
-- FormVersion, then drops the bespoke table.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` is safe here because the new value is never
-- used within this migration's transaction (PG16).

-- ── Enum: ApplicationCycleType ────────────────────────────────────────────────
ALTER TYPE "ApplicationCycleType" RENAME VALUE 'InternToFull' TO 'Fellowship';
ALTER TYPE "ApplicationCycleType" ADD VALUE 'Core';

-- ── Enum: ApplicationType ─────────────────────────────────────────────────────
ALTER TYPE "ApplicationType" RENAME VALUE 'InternToFull' TO 'Fellowship';
ALTER TYPE "ApplicationType" ADD VALUE 'Core';

-- ── Column: ApplicationCycle.internsNotifiedAt → applicantsNotifiedAt ──────────
ALTER TABLE "ApplicationCycle" RENAME COLUMN "internsNotifiedAt" TO "applicantsNotifiedAt";

-- ── Shortform → Drive Form conversion ─────────────────────────────────────────
-- One Form + one v1 FormVersion per existing InternToFullFormVersion row.
-- Deterministic ids ('form_'/'fv_' + source id) let us repoint below. Forms are
-- left unplaced (folderId null) and unpublished — the hiring surfaces read the
-- version directly; eligibility stays the fill gate.
INSERT INTO "Form" ("id", "name", "createdAt", "updatedAt", "createdById")
SELECT 'form_' || itf."id",
       'Fellowship application (v' || itf."version" || ')',
       itf."createdAt", CURRENT_TIMESTAMP, itf."createdById"
FROM "InternToFullFormVersion" itf;

INSERT INTO "FormVersion" ("id", "createdAt", "versionNumber", "questions", "formId", "createdById")
SELECT 'fv_' || itf."id", itf."createdAt", 1, itf."questions", 'form_' || itf."id", itf."createdById"
FROM "InternToFullFormVersion" itf;

-- New binding columns: cycle → Form (definition), application → FormVersion (pin).
ALTER TABLE "ApplicationCycle" ADD COLUMN "applicationFormId" TEXT;
ALTER TABLE "Application" ADD COLUMN "applicationFormVersionId" TEXT;

UPDATE "ApplicationCycle" SET "applicationFormId" = 'form_' || "internToFullFormVersionId"
  WHERE "internToFullFormVersionId" IS NOT NULL;
UPDATE "Application" SET "applicationFormVersionId" = 'fv_' || "internToFullFormVersionId"
  WHERE "internToFullFormVersionId" IS NOT NULL;

ALTER TABLE "ApplicationCycle" ADD CONSTRAINT "ApplicationCycle_applicationFormId_fkey"
  FOREIGN KEY ("applicationFormId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_applicationFormVersionId_fkey"
  FOREIGN KEY ("applicationFormVersionId") REFERENCES "FormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retire the bespoke shortform table + its FK columns.
ALTER TABLE "ApplicationCycle" DROP CONSTRAINT "ApplicationCycle_internToFullFormVersionId_fkey";
ALTER TABLE "ApplicationCycle" DROP COLUMN "internToFullFormVersionId";
ALTER TABLE "Application" DROP CONSTRAINT "Application_internToFullFormVersionId_fkey";
ALTER TABLE "Application" DROP COLUMN "internToFullFormVersionId";
DROP TABLE "InternToFullFormVersion";

-- ── Domain.isSystem flag ──────────────────────────────────────────────────────
ALTER TABLE "Domain" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- ── Seed the single synthetic "CORE" domain (backs Core cycles) ───────────────
INSERT INTO "Domain" ("id", "createdAt", "updatedAt", "name", "code", "displayName", "isInternProgram", "isSystem", "active")
VALUES ('domain_core_system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Core', 'CORE', 'Core', false, true, true)
ON CONFLICT ("code") DO NOTHING;
