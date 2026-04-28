-- Add unique constraint on (userId, applicationCycleId) for Application.
-- See issue #257: the submission endpoint did a check-then-create against a
-- non-atomic predicate, allowing two concurrent POSTs to both pass the
-- existence check and create duplicate Application rows for the same
-- user+cycle. The DB-level invariant is the durable fix; the writers also
-- move to upsert/idempotent paths.

-- ── Dedupe existing duplicate rows before adding the unique index ────────────
-- For each (userId, applicationCycleId) duplicate group: pick a winner, move
-- all children (DomainApplication, ApplicationStatusUpdate) from losers onto
-- the winner so FKs remain valid, then delete the losers.
--
-- Winner-selection rule (matches plan in issue #257): row whose latest
-- ApplicationStatusUpdate is most advanced (Submitted > Draft > Withdrawn),
-- tie-break by most recent updatedAt, then id for a total order. The same
-- ordering is used in every step below to ensure a single canonical winner
-- per group.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "Application"
        GROUP BY "userId", "applicationCycleId"
        HAVING COUNT(*) > 1
    ) THEN
        -- Snapshot the winner/loser assignment in a temp table so each step
        -- below operates on the same partitioning.
        CREATE TEMP TABLE _app_dedupe ON COMMIT DROP AS
        WITH ranked AS (
            SELECT
                a."id",
                a."userId",
                a."applicationCycleId",
                ROW_NUMBER() OVER (
                    PARTITION BY a."userId", a."applicationCycleId"
                    ORDER BY
                        CASE (
                            SELECT su."newStatus"::text
                            FROM "ApplicationStatusUpdate" su
                            WHERE su."applicationId" = a."id"
                            ORDER BY su."createdAt" DESC
                            LIMIT 1
                        )
                            WHEN 'Submitted' THEN 0
                            WHEN 'Draft' THEN 1
                            WHEN 'Withdrawn' THEN 2
                            ELSE 3
                        END,
                        a."updatedAt" DESC,
                        a."id" DESC
                ) AS rn
            FROM "Application" a
        ),
        winners AS (
            SELECT "id" AS winner_id, "userId", "applicationCycleId"
            FROM ranked WHERE rn = 1
        )
        SELECT
            r."id" AS loser_id,
            w.winner_id
        FROM ranked r
        JOIN winners w
          ON w."userId" = r."userId"
         AND w."applicationCycleId" = r."applicationCycleId"
        WHERE r.rn > 1;

        UPDATE "DomainApplication" da
        SET "applicationId" = d.winner_id
        FROM _app_dedupe d
        WHERE da."applicationId" = d.loser_id;

        UPDATE "ApplicationStatusUpdate" su
        SET "applicationId" = d.winner_id
        FROM _app_dedupe d
        WHERE su."applicationId" = d.loser_id;

        DELETE FROM "Application" a
        USING _app_dedupe d
        WHERE a."id" = d.loser_id;
    END IF;
END $$;

-- ── Add the unique constraint ────────────────────────────────────────────────
CREATE UNIQUE INDEX "Application_userId_applicationCycleId_key"
    ON "Application"("userId", "applicationCycleId");
