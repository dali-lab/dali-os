-- Education offerings no longer store a term. The term an offering "belongs
-- to" was always a pure function of its first session date (the backfill in
-- 20260824180000_education_offering_term and termIdForDate() computed the same
-- thing), so the column was a denormalized cache of a date lookup. Everything
-- that needs a term label or a term-scoped slice now derives it from
-- `startsAt` against the Term date windows at read time.
--
-- Data loss: the FK column is dropped. Nothing is lost that cannot be
-- recomputed from `startsAt` — offerings whose start date falls outside every
-- seeded term window had a null termId anyway.

-- DropForeignKey
ALTER TABLE "EducationOffering" DROP CONSTRAINT "EducationOffering_termId_fkey";

-- DropIndex
DROP INDEX "EducationOffering_termId_idx";

-- AlterTable
ALTER TABLE "EducationOffering" DROP COLUMN "termId";
