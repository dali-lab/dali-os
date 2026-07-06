-- Backfill the real Dartmouth registrar dates onto existing Term rows. Source:
--   https://registrar.dartmouth.edu/calendars/academic-institutional-calendars
--
-- "startDate" = first day of CLASSES. "endDate" = last day of the Final
-- Examination period. UTC midnight is used so the stored timestamps match the
-- bare calendar day regardless of server tz.
--
-- Mirrors the REGISTRAR_DATES table in prisma/seeds/v0-reference.ts. Whenever
-- the registrar publishes a new academic year, add four entries to that table
-- AND ship a follow-up UPDATE migration so existing prod rows correct too.
--
-- 28X (Summer 2028) and 28F (Fall 2028) are NOT touched here — the 2028-2029
-- registrar calendar is not yet published. If existing rows for those terms
-- were created by an earlier seed run, they retain whatever dates they have
-- until the follow-up migration lands.
--
-- Idempotent: each UPDATE matches by unique `code`, so re-running is a no-op.
-- WHERE clause guard means a fresh DB without the row simply doesn't update.

UPDATE "Term" SET "startDate" = '2025-09-15', "endDate" = '2025-11-26' WHERE code = '25F';
UPDATE "Term" SET "startDate" = '2026-01-05', "endDate" = '2026-03-17' WHERE code = '26W';
UPDATE "Term" SET "startDate" = '2026-03-30', "endDate" = '2026-06-09' WHERE code = '26S';
UPDATE "Term" SET "startDate" = '2026-06-25', "endDate" = '2026-09-01' WHERE code = '26X';
UPDATE "Term" SET "startDate" = '2026-09-14', "endDate" = '2026-11-25' WHERE code = '26F';
UPDATE "Term" SET "startDate" = '2027-01-05', "endDate" = '2027-03-16' WHERE code = '27W';
UPDATE "Term" SET "startDate" = '2027-03-29', "endDate" = '2027-06-08' WHERE code = '27S';
UPDATE "Term" SET "startDate" = '2027-06-24', "endDate" = '2027-08-31' WHERE code = '27X';
UPDATE "Term" SET "startDate" = '2027-09-13', "endDate" = '2027-11-24' WHERE code = '27F';
UPDATE "Term" SET "startDate" = '2028-01-04', "endDate" = '2028-03-14' WHERE code = '28W';
UPDATE "Term" SET "startDate" = '2028-03-27', "endDate" = '2028-06-06' WHERE code = '28S';
