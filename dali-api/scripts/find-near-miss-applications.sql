-- Adjacent failure modes for applicants who didn't submit. Run each block
-- independently. All blocks exclude applications that were ever Submitted.
--
-- Scope: by default these look across all cycles. Add
--   AND a."applicationCycleId" = '<cycle id>'
-- (or whatever the right column is in the block) to scope to one.

-- ─── 1. Near-miss applications ─────────────────────────────────────────────
-- Unsubmitted apps with at least one selected domain, sorted by how few
-- required answers are missing. Useful for spotting applicants who got 95%
-- of the way there.
WITH submitted_app_ids AS (
  SELECT DISTINCT "applicationId"
  FROM "ApplicationStatusUpdate"
  WHERE "newStatus" = 'Submitted'
),
general_required AS (
  SELECT
    a.id AS application_id,
    q->>'key' AS question_key,
    q->'data'->>'label' AS question_label
  FROM "Application" a
  JOIN "ChallengeVersion" cv ON cv.id = a."generalChallengeVersionId"
  CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
  WHERE (q->>'required')::boolean IS TRUE
),
domain_required AS (
  SELECT
    da."applicationId" AS application_id,
    da.id AS domain_application_id,
    q->>'key' AS question_key,
    q->'data'->>'label' AS question_label
  FROM "DomainApplication" da
  JOIN "ChallengeVersion" cv ON cv.id = da."challengeVersionId"
  CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
  WHERE da.selected = true
    AND (q->>'required')::boolean IS TRUE
),
required_counts AS (
  SELECT application_id, COUNT(*) AS required_total
  FROM (
    SELECT application_id, question_key FROM general_required
    UNION ALL
    SELECT application_id, question_key FROM domain_required
  ) x
  GROUP BY application_id
),
general_missing_per_app AS (
  SELECT gr.application_id, COUNT(*) AS missing_count
  FROM general_required gr
  JOIN "Application" a ON a.id = gr.application_id
  WHERE COALESCE(NULLIF(TRIM(a.answers->>gr.question_key), ''), '') = ''
  GROUP BY gr.application_id
),
domain_missing_per_app AS (
  SELECT dr.application_id, COUNT(*) AS missing_count
  FROM domain_required dr
  JOIN "DomainApplication" da ON da.id = dr.domain_application_id
  WHERE COALESCE(NULLIF(TRIM(da.answers->>dr.question_key), ''), '') = ''
  GROUP BY dr.application_id
),
total_missing AS (
  SELECT
    rc.application_id,
    rc.required_total,
    COALESCE(gm.missing_count, 0) + COALESCE(dm.missing_count, 0) AS missing_total
  FROM required_counts rc
  LEFT JOIN general_missing_per_app gm ON gm.application_id = rc.application_id
  LEFT JOIN domain_missing_per_app dm ON dm.application_id = rc.application_id
),
selected_counts AS (
  SELECT "applicationId" AS application_id, COUNT(*) AS selected_domains
  FROM "DomainApplication"
  WHERE selected = true
  GROUP BY "applicationId"
)
SELECT
  a.id                                                    AS application_id,
  u."firstName" || ' ' || u."lastName"                    AS applicant_name,
  COALESCE(u."dartmouthEmail", u."daliEmail", u."netId")  AS contact,
  ac.name                                                 AS cycle_name,
  sc.selected_domains,
  tm.required_total,
  tm.missing_total,
  ROUND(100.0 * (tm.required_total - tm.missing_total) / NULLIF(tm.required_total, 0), 1) AS pct_complete,
  a."updatedAt"
FROM "Application" a
JOIN "User" u              ON u.id = a."userId"
JOIN "ApplicationCycle" ac ON ac.id = a."applicationCycleId"
JOIN selected_counts sc    ON sc.application_id = a.id
JOIN total_missing tm      ON tm.application_id = a.id
WHERE a.id NOT IN (SELECT "applicationId" FROM submitted_app_ids)
  AND tm.missing_total > 0
  AND tm.missing_total <= 3   -- raise/lower to widen/narrow "near miss"
ORDER BY tm.missing_total ASC, a."updatedAt" DESC;


-- ─── 2. Which required questions trip people up most? ──────────────────────
-- Across all unsubmitted apps in cycles that are Open or UnderReview, count
-- how often each required question is left blank. Lets you see if one
-- specific question is acting as a wall.
WITH submitted_app_ids AS (
  SELECT DISTINCT "applicationId"
  FROM "ApplicationStatusUpdate"
  WHERE "newStatus" = 'Submitted'
),
latest_cycle_status AS (
  SELECT DISTINCT ON ("applicationCycleId")
    "applicationCycleId", "newStatus"
  FROM "ApplicationCycleStatusUpdate"
  ORDER BY "applicationCycleId", "createdAt" DESC
),
active_cycle_ids AS (
  SELECT "applicationCycleId" FROM latest_cycle_status
  WHERE "newStatus" IN ('Open', 'UnderReview')
),
unsubmitted_apps AS (
  SELECT a.id, a."generalChallengeVersionId", a.answers
  FROM "Application" a
  WHERE a.id NOT IN (SELECT "applicationId" FROM submitted_app_ids)
    AND a."applicationCycleId" IN (SELECT "applicationCycleId" FROM active_cycle_ids)
),
general_blanks AS (
  SELECT
    'general'::text AS source,
    q->'data'->>'label' AS question_label,
    q->>'key' AS question_key,
    COUNT(*) AS unanswered_apps
  FROM unsubmitted_apps ua
  JOIN "ChallengeVersion" cv ON cv.id = ua."generalChallengeVersionId"
  CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
  WHERE (q->>'required')::boolean IS TRUE
    AND COALESCE(NULLIF(TRIM(ua.answers->>(q->>'key')), ''), '') = ''
  GROUP BY 1, 2, 3
),
domain_blanks AS (
  SELECT
    d.name AS source,
    q->'data'->>'label' AS question_label,
    q->>'key' AS question_key,
    COUNT(*) AS unanswered_apps
  FROM "DomainApplication" da
  JOIN unsubmitted_apps ua    ON ua.id = da."applicationId"
  JOIN "ChallengeVersion" cv  ON cv.id = da."challengeVersionId"
  JOIN "Domain" d             ON d.id = cv."domainId"
  CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
  WHERE da.selected = true
    AND (q->>'required')::boolean IS TRUE
    AND COALESCE(NULLIF(TRIM(da.answers->>(q->>'key')), ''), '') = ''
  GROUP BY 1, 2, 3
)
SELECT * FROM general_blanks
UNION ALL
SELECT * FROM domain_blanks
ORDER BY unanswered_apps DESC;


-- ─── 3. Applications with no selected domains ──────────────────────────────
-- Unsubmitted apps where the applicant deselected every domain. Can happen
-- if someone toggled domains and never re-selected one.
WITH submitted_app_ids AS (
  SELECT DISTINCT "applicationId"
  FROM "ApplicationStatusUpdate"
  WHERE "newStatus" = 'Submitted'
)
SELECT
  a.id                                                    AS application_id,
  u."firstName" || ' ' || u."lastName"                    AS applicant_name,
  COALESCE(u."dartmouthEmail", u."daliEmail", u."netId")  AS contact,
  ac.name                                                 AS cycle_name,
  (SELECT COUNT(*) FROM "DomainApplication" da WHERE da."applicationId" = a.id) AS domain_app_rows,
  (SELECT COUNT(*) FROM "DomainApplication" da WHERE da."applicationId" = a.id AND da.selected) AS selected,
  jsonb_array_length(
    CASE WHEN jsonb_typeof(a.answers) = 'object'
         THEN (SELECT jsonb_agg(k) FROM jsonb_object_keys(a.answers) k)
         ELSE '[]'::jsonb END
  ) AS general_answer_keys,
  a."updatedAt"
FROM "Application" a
JOIN "User" u              ON u.id = a."userId"
JOIN "ApplicationCycle" ac ON ac.id = a."applicationCycleId"
WHERE a.id NOT IN (SELECT "applicationId" FROM submitted_app_ids)
  AND NOT EXISTS (
    SELECT 1 FROM "DomainApplication" da
    WHERE da."applicationId" = a.id AND da.selected = true
  )
ORDER BY a."updatedAt" DESC;


-- ─── 4. Users who never created an Application in active cycles ────────────
-- Users who exist but have no Application row in any currently Open cycle.
-- High-signal only if you have a way to scope to "people who should have
-- applied" — by default this lists every user in the system, which is noisy.
-- Comment in a filter (class year, daliEmail null, etc.) to make it useful.
WITH latest_cycle_status AS (
  SELECT DISTINCT ON ("applicationCycleId")
    "applicationCycleId", "newStatus"
  FROM "ApplicationCycleStatusUpdate"
  ORDER BY "applicationCycleId", "createdAt" DESC
),
open_cycles AS (
  SELECT "applicationCycleId" FROM latest_cycle_status WHERE "newStatus" = 'Open'
)
SELECT
  u.id,
  u."firstName" || ' ' || u."lastName" AS name,
  COALESCE(u."dartmouthEmail", u."daliEmail", u."netId") AS contact,
  u."classYear",
  u."createdAt"
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Application" a
  WHERE a."userId" = u.id
    AND a."applicationCycleId" IN (SELECT "applicationCycleId" FROM open_cycles)
)
-- AND u."classYear" IS NOT NULL  -- example filter
ORDER BY u."createdAt" DESC
LIMIT 100;
