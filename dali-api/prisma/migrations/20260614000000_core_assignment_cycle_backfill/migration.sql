-- Backfill: materialize CoreAssignment rows across the full election cycle.
--
-- Previously a Core election only wrote a single CoreAssignment row anchored
-- on the Spring term it was set during; readers like `isCore` then derived
-- cycle membership at query time. As of this migration, writers fan out the
-- assignment across every term in the cycle window [Spring N, Spring N+1)
-- (4 terms — S, X, F, W) so reads by termId can stand on their own.
--
-- This backfill makes existing data consistent with that contract.
--
-- Cycle math (mirrors app/lib/core-cycle.ts):
--   Season digit = sortKey % 10. W=1, S=2, X=3, F=4.
--   cycle_start =  (W) sk - 9, (S) sk, (X) sk - 1, (F) sk - 2.
--   cycle window = [cycle_start, cycle_start + 10) — 4 consecutive terms.
--
-- For each distinct (userId, leadTitle, cycle_start) implied by the existing
-- rows, we insert any missing (userId, termId, leadTitle) triples. The
-- NOT EXISTS guard makes this idempotent and safe to re-run; we do not
-- delete or modify any existing rows.

INSERT INTO "CoreAssignment" (id, "userId", "termId", "leadTitle")
SELECT
  'cab_' || REPLACE(gen_random_uuid()::text, '-', '') AS id,
  cycles."userId",
  t.id                                                AS "termId",
  cycles."leadTitle"
FROM (
  SELECT DISTINCT
    ca."userId",
    ca."leadTitle",
    CASE
      WHEN anchor."sortKey" % 10 = 1 THEN anchor."sortKey" - 9
      ELSE anchor."sortKey" - (anchor."sortKey" % 10) + 2
    END AS cycle_start
  FROM "CoreAssignment" ca
  JOIN "Term" anchor ON anchor.id = ca."termId"
) cycles
JOIN "Term" t
  ON t."sortKey" >= cycles.cycle_start
 AND t."sortKey" <  cycles.cycle_start + 10
WHERE NOT EXISTS (
  SELECT 1
  FROM "CoreAssignment" existing
  WHERE existing."userId" = cycles."userId"
    AND existing."termId" = t.id
    AND (
      (existing."leadTitle" IS NULL AND cycles."leadTitle" IS NULL)
      OR existing."leadTitle" = cycles."leadTitle"
    )
);
