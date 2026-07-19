-- Dartmouth payroll chart string for each project. chartStringType is the GL
-- account category (e.g. "Grant", "Department"); chartString is the full
-- concatenated GL string. Both are admin-edited and surfaced in the payroll
-- export. Nullable: admins backfill as projects come up for payroll.
ALTER TABLE "Project" ADD COLUMN "chartStringType" TEXT;
ALTER TABLE "Project" ADD COLUMN "chartString" TEXT;
