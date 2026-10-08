-- At most one Scheduled interview per DomainApplication, at the DB level.
-- The schema comment on Interview has described this partial unique index
-- since the location column was added, but no migration ever created it;
-- only the schedule route's app-side check stopped duplicates. Prisma can't
-- express a partial index, so it lives here in raw SQL.
--
-- Refuses loudly (naming the rows) rather than silently cancelling anything
-- if live data already violates it: an operator resolves those by hand and
-- re-runs the deploy.
DO $$
DECLARE
  dup TEXT;
BEGIN
  SELECT string_agg("domainApplicationId" || ' (' || n || ' scheduled)', ', ')
    INTO dup
  FROM (
    SELECT "domainApplicationId", count(*) AS n
    FROM "Interview"
    WHERE status = 'Scheduled'
    GROUP BY "domainApplicationId"
    HAVING count(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Interview_activeDomainApplication_key: DomainApplications with more than one Scheduled interview: %', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX "Interview_activeDomainApplication_key"
  ON "Interview" ("domainApplicationId")
  WHERE status = 'Scheduled';
