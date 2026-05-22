-- Drill-down: list every required question on an application and whether
-- the applicant answered it. Replace the application id below.

\set app_id '\'cmoqc1ki800lxias9unq5ugoz\''

SELECT
  'general'::text AS source,
  q->'data'->>'label' AS question_label,
  q->>'key' AS question_key,
  (q->>'required')::boolean AS required,
  q->>'type' AS type,
  CASE
    WHEN COALESCE(NULLIF(TRIM(a.answers->>(q->>'key')), ''), '') = '' THEN 'BLANK'
    ELSE 'answered (' || LENGTH(a.answers->>(q->>'key')) || ' chars)'
  END AS status
FROM "Application" a
JOIN "ChallengeVersion" cv ON cv.id = a."generalChallengeVersionId"
CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
WHERE a.id = :app_id

UNION ALL

SELECT
  d.name AS source,
  q->'data'->>'label' AS question_label,
  q->>'key' AS question_key,
  (q->>'required')::boolean AS required,
  q->>'type' AS type,
  CASE
    WHEN COALESCE(NULLIF(TRIM(da.answers->>(q->>'key')), ''), '') = '' THEN 'BLANK'
    ELSE 'answered (' || LENGTH(da.answers->>(q->>'key')) || ' chars)'
  END AS status
FROM "DomainApplication" da
JOIN "ChallengeVersion" cv ON cv.id = da."challengeVersionId"
JOIN "Domain" d            ON d.id = cv."domainId"
CROSS JOIN LATERAL jsonb_array_elements(cv.questions) AS q
WHERE da."applicationId" = :app_id
  AND da.selected = true

ORDER BY source, required DESC, question_label;
