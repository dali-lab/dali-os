-- Core hiring cycle + rename of the "InternToFull" internal cycle to "Fellowship".
--
-- All renames are non-destructive: enum values, the shortform table, its
-- constraints, and the FK columns are RENAMEd in place (rows and data are
-- preserved). We also add the `Core` enum values, a `Domain.isSystem` flag, and
-- seed the single synthetic "CORE" domain that backs Core cycles.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` is safe here because the new value is never
-- used within this migration's transaction (PG16).

-- ── Enum: ApplicationCycleType ────────────────────────────────────────────────
ALTER TYPE "ApplicationCycleType" RENAME VALUE 'InternToFull' TO 'Fellowship';
ALTER TYPE "ApplicationCycleType" ADD VALUE 'Core';

-- ── Enum: ApplicationType ─────────────────────────────────────────────────────
ALTER TYPE "ApplicationType" RENAME VALUE 'InternToFull' TO 'Fellowship';
ALTER TYPE "ApplicationType" ADD VALUE 'Core';

-- ── Table + constraints: InternToFullFormVersion → ShortformVersion ───────────
ALTER TABLE "InternToFullFormVersion" RENAME TO "ShortformVersion";
ALTER TABLE "ShortformVersion" RENAME CONSTRAINT "InternToFullFormVersion_pkey" TO "ShortformVersion_pkey";
ALTER INDEX "InternToFullFormVersion_version_key" RENAME TO "ShortformVersion_version_key";
ALTER TABLE "ShortformVersion" RENAME CONSTRAINT "InternToFullFormVersion_createdById_fkey" TO "ShortformVersion_createdById_fkey";

-- ── Column + FK: ApplicationCycle.internToFullFormVersionId → shortformVersionId
ALTER TABLE "ApplicationCycle" RENAME COLUMN "internToFullFormVersionId" TO "shortformVersionId";
ALTER TABLE "ApplicationCycle" RENAME CONSTRAINT "ApplicationCycle_internToFullFormVersionId_fkey" TO "ApplicationCycle_shortformVersionId_fkey";

-- ── Column: ApplicationCycle.internsNotifiedAt → applicantsNotifiedAt ──────────
ALTER TABLE "ApplicationCycle" RENAME COLUMN "internsNotifiedAt" TO "applicantsNotifiedAt";

-- ── Column + FK: Application.internToFullFormVersionId → shortformVersionId ────
ALTER TABLE "Application" RENAME COLUMN "internToFullFormVersionId" TO "shortformVersionId";
ALTER TABLE "Application" RENAME CONSTRAINT "Application_internToFullFormVersionId_fkey" TO "Application_shortformVersionId_fkey";

-- ── Domain.isSystem flag ──────────────────────────────────────────────────────
ALTER TABLE "Domain" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- ── Seed the single synthetic "CORE" domain (backs Core cycles) ───────────────
INSERT INTO "Domain" ("id", "createdAt", "updatedAt", "name", "code", "displayName", "isInternProgram", "isSystem", "active")
VALUES ('domain_core_system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Core', 'CORE', 'Core', false, true, true)
ON CONFLICT ("code") DO NOTHING;
