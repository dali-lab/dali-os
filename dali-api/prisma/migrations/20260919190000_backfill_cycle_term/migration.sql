-- Cycles gained a term in 20260919140000 but nothing filled it in, so every
-- cycle created before that migration still has none. Hiring reads the term for
-- its week dates and for the onboarding page's start filter, so backfill it
-- from the one date those cycles do have: applications close during the term
-- the members start in, so the term whose start falls most recently before the
-- close date is that cycle's term.
--
-- A cycle with no close date keeps termId NULL: there's nothing to infer from,
-- and the cycle page's term picker sets it.

UPDATE "ApplicationCycle" c
SET "termId" = (
  SELECT t.id
  FROM "Term" t
  WHERE t."startDate" <= c."closeDate"
  ORDER BY t."startDate" DESC
  LIMIT 1
)
WHERE c."termId" IS NULL
  AND c."closeDate" IS NOT NULL;
