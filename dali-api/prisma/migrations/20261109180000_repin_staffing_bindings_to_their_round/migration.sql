-- The previous migration's backfill pinned every existing binding to its
-- form's CURRENT latest version. For a binding made during an older version's
-- round that recreates the conflict the pin exists to avoid: the old cycle
-- looks like it holds the latest version, so binding that version to a new
-- cycle still warns about a move.
--
-- Re-pin only the rows that backfill plausibly mis-pinned: the pinned version
-- was created AFTER the manager last touched the binding (the raw backfill
-- UPDATE didn't bump updatedAt, while every real bind through the app does),
-- and no submission under the binding's cycle+slot ever used that version.
-- Rows bound through the app since the pin shipped, and rows whose round
-- really did collect the pinned version, are untouched.
--
-- The new pin is the newest version among the binding's recorded submissions,
-- else the newest version that existed when the binding was last touched,
-- else the current pin stays.
UPDATE "StaffingCycleFormBinding" b
SET "formVersionId" = COALESCE(
  (
    SELECT v."id" FROM "FormVersion" v
    JOIN "FormSubmission" s ON s."formVersionId" = v."id"
    WHERE s."staffingCycleId" = b."staffingCycleId"
      AND s."slot" = b."slot"
      AND s."formId" = b."formId"
    ORDER BY v."versionNumber" DESC
    LIMIT 1
  ),
  (
    SELECT v."id" FROM "FormVersion" v
    WHERE v."formId" = b."formId" AND v."createdAt" <= b."updatedAt"
    ORDER BY v."versionNumber" DESC
    LIMIT 1
  ),
  b."formVersionId"
)
WHERE b."formVersionId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "FormVersion" pinned
    WHERE pinned."id" = b."formVersionId"
      AND pinned."createdAt" > b."updatedAt"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "FormSubmission" s
    WHERE s."staffingCycleId" = b."staffingCycleId"
      AND s."slot" = b."slot"
      AND s."formVersionId" = b."formVersionId"
  );
