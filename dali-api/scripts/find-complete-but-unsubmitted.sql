-- Applications that look "complete" (every required question on the general
-- challenge + every selected domain's challenge has a non-empty answer) but
-- were never submitted (no ApplicationStatusUpdate with newStatus='Submitted').
--
-- Caveats:
--   * "Answered" here = answer JSON value is a non-empty string. The app's
--     isAnswered() also runs a richer check for skills_rating questions; this
--     SQL treats any non-empty string as answered, which can over-count
--     completeness for skills_rating but never under-counts. False positives
--     are easy to spot when reviewing the row.
--   * Applications with zero selected domains are excluded — they can't be
--     "complete" in any meaningful sense.
--   * Withdrawn applicants are included; filter them out below if you want
--     only people who never withdrew.
--
-- Optional: scope to a specific cycle by uncommenting the WHERE clause near
-- the bottom.

WITH submitted_app_ids AS (
  SELECT DISTINCT "applicationId"
  FROM "ApplicationStatusUpdate"
  WHERE "newStatus" = 'Submitted'
),
withdrawn_app_ids AS (
  SELECT DISTINCT "applicationId"
  FROM "ApplicationStatusUpdate"
  WHERE "newStatus" = 'Withdrawn'
),
-- Required general questions per application
general_required AS (
  SELECT
    a.id AS application_id,
    q->>'key' AS question_key
  FROM "Application" a
  JOIN "ChallengeVersion" cv ON cv.id = a."generalChallengeVersionId"
  CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
  WHERE (q->>'required')::boolean IS TRUE
),
general_missing AS (
  SELECT gr.application_id
  FROM general_required gr
  JOIN "Application" a ON a.id = gr.application_id
  WHERE COALESCE(NULLIF(TRIM(a.answers->>gr.question_key), ''), '') = ''
  GROUP BY gr.application_id
),
-- Required questions per selected domain application
domain_required AS (
  SELECT
    da."applicationId" AS application_id,
    da.id AS domain_application_id,
    q->>'key' AS question_key
  FROM "DomainApplication" da
  JOIN "ChallengeVersion" cv ON cv.id = da."challengeVersionId"
  CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
  WHERE da.selected = true
    AND (q->>'required')::boolean IS TRUE
),
domain_missing AS (
  SELECT dr.application_id
  FROM domain_required dr
  JOIN "DomainApplication" da ON da.id = dr.domain_application_id
  WHERE COALESCE(NULLIF(TRIM(da.answers->>dr.question_key), ''), '') = ''
  GROUP BY dr.application_id
),
selected_counts AS (
  SELECT "applicationId" AS application_id, COUNT(*) AS selected_domains
  FROM "DomainApplication"
  WHERE selected = true
  GROUP BY "applicationId"
)
SELECT
  a.id                                                        AS application_id,
  u.id                                                        AS user_id,
  u."firstName" || ' ' || u."lastName"                        AS applicant_name,
  COALESCE(u."dartmouthEmail", u."daliEmail", u."netId")      AS contact,
  ac.name                                                     AS cycle_name,
  a."applicationCycleId"                                      AS cycle_id,
  sc.selected_domains,
  a."createdAt",
  a."updatedAt",
  (a.id IN (SELECT "applicationId" FROM withdrawn_app_ids))   AS withdrawn
FROM "Application" a
JOIN "User" u             ON u.id = a."userId"
JOIN "ApplicationCycle" ac ON ac.id = a."applicationCycleId"
JOIN selected_counts sc    ON sc.application_id = a.id
WHERE a.id NOT IN (SELECT "applicationId" FROM submitted_app_ids)
  AND a.id NOT IN (SELECT application_id FROM general_missing)
  AND a.id NOT IN (SELECT application_id FROM domain_missing)
  -- AND a."applicationCycleId" = '<cycle id here>'
ORDER BY a."updatedAt" DESC;
