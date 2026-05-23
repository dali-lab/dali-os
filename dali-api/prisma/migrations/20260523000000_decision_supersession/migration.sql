-- Decision supersession: enforce at most one non-superseded Decision per
-- (domainApplication, stage). Older rows in a stage are marked superseded
-- when a newer one is written; the partial unique index makes the duplicate
-- state unrepresentable in the DB.
--
-- Order matters: add columns -> backfill existing duplicates -> create the
-- partial unique index. The backfill must run before the index, otherwise
-- the index creation fails on existing prod data.

-- ── Columns ──────────────────────────────────────────────────────────────
ALTER TABLE "Decision" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "Decision" ADD COLUMN "supersededById" TEXT;

ALTER TABLE "Decision"
  ADD CONSTRAINT "Decision_supersededById_fkey"
  FOREIGN KEY ("supersededById") REFERENCES "Decision"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Decision_supersededById_idx" ON "Decision"("supersededById");

-- ── Backfill ─────────────────────────────────────────────────────────────
-- For each (domainApplicationId, stage) group with more than one row, keep
-- the newest by createdAt as active and mark all older rows as superseded
-- by it. supersededAt is set to NOW() (we don't know the original
-- supersession time; this just records that the row was retired during the
-- migration).
WITH ranked AS (
  SELECT
    id,
    "domainApplicationId",
    stage,
    "createdAt",
    ROW_NUMBER() OVER (
      PARTITION BY "domainApplicationId", stage
      ORDER BY "createdAt" DESC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY "domainApplicationId", stage
      ORDER BY "createdAt" DESC
    ) AS newest_id
  FROM "Decision"
)
UPDATE "Decision" d
SET
  "supersededAt"   = NOW(),
  "supersededById" = ranked.newest_id
FROM ranked
WHERE d.id = ranked.id
  AND ranked.rn > 1;

-- ── Partial unique index ─────────────────────────────────────────────────
CREATE UNIQUE INDEX "Decision_one_active_per_stage"
  ON "Decision" ("domainApplicationId", stage)
  WHERE "supersededAt" IS NULL;
