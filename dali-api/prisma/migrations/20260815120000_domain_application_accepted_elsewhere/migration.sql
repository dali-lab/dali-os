-- Administrative closure of undecided DomainApplications when the applicant was
-- accepted into a different domain in the SAME cycle (single placement: an
-- Accept is final, so sibling domains are moot). This replaces the stale
-- "Pending" those rows would otherwise infer with an explicit "Accepted
-- elsewhere" lifecycle state. Non-destructive: no rows deleted, no decisions
-- rewritten — only a new flag on otherwise-undecided rows.

-- 1. Closure-reason enum + additive columns.
CREATE TYPE "DomainApplicationClosureReason" AS ENUM ('AcceptedElsewhere');

ALTER TABLE "DomainApplication" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "DomainApplication" ADD COLUMN "closureReason" "DomainApplicationClosureReason";

-- 2. Backfill history. Close every still-undecided, applicant-selected DA whose
--    application ALSO has a sibling DA with a Released Accepted decision.
--    "Undecided" = no Released decision of its own, so the accepted DA itself
--    (Released Accepted) and any Rejected/Waitlisted sibling (Released) are
--    left untouched — only pending / in-progress / interview-pending siblings
--    are closed. Timestamp = when the sibling acceptance was released.
UPDATE "DomainApplication" da
SET "closureReason" = 'AcceptedElsewhere',
    "closedAt" = acc."acceptedAt"
FROM (
  SELECT sda."applicationId" AS "applicationId", MIN(d."createdAt") AS "acceptedAt"
  FROM "DomainApplication" sda
  JOIN "Decision" d
    ON d."domainApplicationId" = sda."id"
   AND d."stage" = 'Released'
   AND d."type" = 'Accepted'
  GROUP BY sda."applicationId"
) acc
WHERE da."applicationId" = acc."applicationId"
  AND da."selected" = true
  AND da."closureReason" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Decision" d2
    WHERE d2."domainApplicationId" = da."id"
      AND d2."stage" = 'Released'
  );
