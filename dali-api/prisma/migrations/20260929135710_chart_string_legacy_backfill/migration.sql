-- AlterTable
ALTER TABLE "ProjectChartString" ALTER COLUMN "createdById" DROP NOT NULL;

-- Carry the legacy Project.chartString values into ProjectChartString before
-- anything stops reading the old column.
--
-- Payroll export and the collation seam read Project.chartString, and this
-- table is empty in production. Repointing those readers without this step
-- would move every program from .3000 to the lab's .4000 default and every
-- sponsored project off its PTAEO. So each stored value lands here as payroll
-- charges it today: the project's current row for the current term — the one
-- containing now(), else the next one, matching currentTerm().
--
-- An import, not a repair. Stale 722-org strings, a truncated PTAEO and a
-- tel:-autolinked value come across as they are and say so in `note`.
-- Re-entering one through the project panel supersedes it, and this row stays
-- as history. Normalization is the same as the write path's: trim, strip a
-- URI scheme, upper-case. The declared type only decides when the shape can't
-- (legacy spells PTAEO "PATEO").
--
-- A project that already has a current row for that term is skipped: the
-- write path mirrored that row into Project.chartString, so it's already here.
-- On an empty database (CI, a fresh local reset) there is no term and nothing
-- is inserted.
WITH term AS (
  SELECT COALESCE(
    (SELECT "id" FROM "Term"
      WHERE "startDate" <= now() AND "endDate" >= now()
      ORDER BY "sortKey" DESC LIMIT 1),
    (SELECT "id" FROM "Term"
      WHERE "startDate" > now()
      ORDER BY "sortKey" ASC LIMIT 1)
  ) AS "id"
),
legacy AS (
  SELECT
    p."id" AS "projectId",
    p."chartString" AS "raw",
    upper(btrim(regexp_replace(btrim(p."chartString"), '^(tel|mailto|callto|sms):', '', 'i'))) AS "normalized",
    upper(coalesce(p."chartStringType", '')) AS "declared"
  FROM "Project" p
  WHERE p."chartString" IS NOT NULL AND btrim(p."chartString") <> ''
),
typed AS (
  SELECT
    l.*,
    CASE
      WHEN l."normalized" ~ '^[0-9]{2}\.' THEN 'GL'
      WHEN l."normalized" ~ '^[0-9]{6}\.' THEN 'PTAEO'
      WHEN l."declared" = 'GL' THEN 'GL'
      ELSE 'PTAEO'
    END AS "type"
  FROM legacy l
)
INSERT INTO "ProjectChartString" (
  "id", "projectId", "termId", "raw", "normalized", "type",
  "projectCode", "subactivity", "org", "awardCode",
  "isCurrent", "note", "createdAt", "createdById"
)
SELECT
  'legacy-' || md5(t."projectId" || ':' || term."id"),
  t."projectId",
  term."id",
  t."raw",
  t."normalized",
  t."type"::"ChartStringType",
  CASE t."type" WHEN 'GL' THEN split_part(t."normalized", '.', 4)
                ELSE split_part(t."normalized", '.', 1) END,
  CASE t."type" WHEN 'GL' THEN nullif(split_part(t."normalized", '.', 5), '') END,
  CASE t."type" WHEN 'GL' THEN nullif(split_part(t."normalized", '.', 2), '')
                ELSE nullif(split_part(t."normalized", '.', 5), '') END,
  CASE t."type" WHEN 'PTAEO' THEN nullif(split_part(t."normalized", '.', 3), '') END,
  true,
  'Imported unchanged from the legacy Project.chartString column when it was retired. Not validated: re-enter it from the source document to supersede.',
  now(),
  NULL
FROM typed t
CROSS JOIN term
WHERE term."id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectChartString" c
    WHERE c."projectId" = t."projectId"
      AND c."termId" = term."id"
      AND c."isCurrent"
  );
