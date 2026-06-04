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

-- ── Manual overrides for known-misordered Finals ─────────────────────────
-- For 5 PM-domain applicants, the generic newest-wins backfill above picks
-- the WRONG survivor. Timeline (verified against Draft history): the lead
-- correctly finalized a Rejected Draft, then accidentally double-finalized
-- a stale InvitedToInterview Draft 30-90 seconds later. The newer Final is
-- the mistake; intent was Rejected (confirmed by delibs lead on
-- 2026-05-23). We flip the survivor for these 5 applicants here.
--
-- Safety: each block reads the current state before writing and skips the
-- applicant if it doesn't match expectations (e.g. the row was manually
-- corrected in prod between when this migration was written and when it
-- runs). Order within each block matters — we never have two
-- non-superseded Final rows visible to the partial unique index that
-- gets created below.
DO $$
DECLARE
  da RECORD;
  reject_id TEXT;
  interview_id TEXT;
  da_ids TEXT[] := ARRAY[
    'cmoyw0q4e0014ics9uo1kjtcz',  -- Eden Gray
    'cmoxwaccx0086ias9r9p3dxvj',  -- Isabel Winer
    'cmoo65ayu00iiias9qlp2rxzh',  -- Siddharth Vikram
    'cmox8jylu001wias9h10t9c85',  -- Colleen Bailey
    'cmowidmeq000mias9s9kjjta0'   -- Kailyn Holty
  ];
  current_da_id TEXT;
BEGIN
  FOREACH current_da_id IN ARRAY da_ids LOOP
    -- Expected state after the generic backfill:
    --   Reject row     -> supersededAt IS NOT NULL (was older)
    --   Interview row  -> supersededAt IS NULL     (was newer, active)
    SELECT id INTO reject_id
    FROM "Decision"
    WHERE "domainApplicationId" = current_da_id
      AND stage = 'Final'
      AND type = 'Rejected'
      AND "supersededAt" IS NOT NULL;

    SELECT id INTO interview_id
    FROM "Decision"
    WHERE "domainApplicationId" = current_da_id
      AND stage = 'Final'
      AND type = 'InvitedToInterview'
      AND "supersededAt" IS NULL;

    IF reject_id IS NULL OR interview_id IS NULL THEN
      RAISE NOTICE 'Skipping override for % — state did not match expected post-backfill shape', current_da_id;
      CONTINUE;
    END IF;

    -- Step 1: supersede the (currently active) Interview row, pointing it
    -- at the Reject row as its supersedor. After this, BOTH rows for this
    -- applicant have supersededAt IS NOT NULL — the partial unique index
    -- (created below) sees no active row yet, so no conflict.
    UPDATE "Decision"
    SET "supersededAt"   = NOW(),
        "supersededById" = reject_id
    WHERE id = interview_id;

    -- Step 2: un-supersede the Reject row, making it the sole active Final
    -- for this applicant. Clear its supersededById (it previously pointed
    -- at the Interview row from the generic backfill).
    UPDATE "Decision"
    SET "supersededAt"   = NULL,
        "supersededById" = NULL
    WHERE id = reject_id;
  END LOOP;
END $$;

-- ── Partial unique index ─────────────────────────────────────────────────
CREATE UNIQUE INDEX "Decision_one_active_per_stage"
  ON "Decision" ("domainApplicationId", stage)
  WHERE "supersededAt" IS NULL;
