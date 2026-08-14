-- BlockNote migration census (specs/blocknote-migration.md, D1/D3/D5 pre-flights).
-- READ-ONLY. Run against prod:  psql "$DATABASE_URL" -f scripts/blocknote-census.sql
--
-- Notes:
-- * Queries 2/9/10 search the Yjs binary for node-name strings. Yjs encodes
--   XmlElement names and attribute keys as literal strings, so this is a solid
--   heuristic — but 'image'/'mention'/'highlight' can false-positive on prose
--   containing those words. camelCase markers (toggleBlock, taskList, codeBlock,
--   lineHeight, tableRow) are effectively unambiguous. Treat hits as "open and
--   eyeball", not ground truth.
-- * Prisma Json columns are jsonb. If a jsonb_path_query errors, add ::jsonb.

-- ============================================================================
-- 1. Room census by prefix — the real surface inventory + activity.
--    Compare prefixes against the plan's surface table: anything unexpected
--    here is an unmapped surface. `edited_last_30d` shapes rollout order.
-- ============================================================================
SELECT split_part(name, ':', 1) AS prefix,
       count(*)                                                    AS docs,
       pg_size_pretty(sum(octet_length(state))::bigint)            AS total_state,
       count(*) FILTER (WHERE "updatedAt" > now() - interval '30 days') AS edited_last_30d,
       max("updatedAt")::date                                      AS last_edit
FROM "CollabDocument"
GROUP BY 1
ORDER BY count(*) DESC;

-- ============================================================================
-- 2. Rich-content collab docs — verifies the "~10 rich docs" assumption and
--    produces the exact list to eyeball after conversion (loss-report targets).
--    `linespacing` hits = docs actually using the accepted-loss D5 feature.
-- ============================================================================
WITH flags AS (
  SELECT name,
         octet_length(state) AS bytes,
         "updatedAt",
         position(convert_to('image','UTF8')       in state) > 0 AS img,
         position(convert_to('tableRow','UTF8')    in state) > 0 AS tbl,
         position(convert_to('callout','UTF8')     in state) > 0 AS callout,
         position(convert_to('toggleBlock','UTF8') in state) > 0 AS toggle,
         position(convert_to('taskList','UTF8')    in state) > 0 AS tasklist,
         position(convert_to('codeBlock','UTF8')   in state) > 0 AS code,
         position(convert_to('mention','UTF8')     in state) > 0 AS mention,
         position(convert_to('lineHeight','UTF8')  in state) > 0 AS linespacing,
         position(convert_to('highlight','UTF8')   in state) > 0 AS highlight
  FROM "CollabDocument"
)
SELECT * FROM flags
WHERE img OR tbl OR callout OR toggle OR tasklist OR code OR mention OR linespacing OR highlight
ORDER BY bytes DESC;

-- ============================================================================
-- 3. Signing census — D1 pre-flight (port signing iff signatures ≈ 0) and
--    Phase 6 transcode workload.
-- ============================================================================
SELECT (SELECT count(*) FROM "SigningDocument")        AS signing_documents,
       (SELECT count(*) FROM "SigningDocumentVersion") AS versions,
       (SELECT count(*) FROM "SigningBinding")         AS bindings,
       (SELECT count(*) FROM "SigningSignature")       AS signatures;

-- ============================================================================
-- 4. Node/mark-type histogram across ALL ProseMirror-JSON columns — the exact
--    coverage the pm-to-blocknote mapper must implement, from prod data (not
--    from what the schema *allows*). Any type NOT in the mapper's list = gap.
-- ============================================================================
WITH src AS (
  SELECT 'MentorNote.contentJson' AS col, "contentJson" AS doc FROM "MentorNote"
  UNION ALL SELECT 'MentorNoteTemplate.contentJson', "contentJson" FROM "MentorNoteTemplate"
  UNION ALL SELECT 'ChallengeVersion.description', "description" FROM "ChallengeVersion" WHERE "description" IS NOT NULL
  UNION ALL SELECT 'PageDoc.body', "body" FROM "PageDoc" WHERE "body" IS NOT NULL
  UNION ALL SELECT 'PageDoc.sections', "sections" FROM "PageDoc" WHERE "sections" IS NOT NULL
  UNION ALL SELECT 'SigningDocumentVersion.body', "body" FROM "SigningDocumentVersion"
  UNION ALL SELECT 'PartnerApplicationDomain.expectedChallenges', "expectedChallenges" FROM "PartnerApplicationDomain" WHERE "expectedChallenges" IS NOT NULL
)
SELECT col, t #>> '{}' AS node_or_mark_type, count(*) AS occurrences
FROM src, LATERAL jsonb_path_query(doc, 'strict $.**.type', '{}'::jsonb, true) AS t
GROUP BY 1, 2
ORDER BY 1, 3 DESC;

-- ============================================================================
-- 5. Rich "info" bodies hiding inside question arrays — Phase 5 blast radius
--    (these are PM JSON rendered via info-body.tsx; missed by column-level
--    transcodes).
-- ============================================================================
SELECT 'ChallengeVersion' AS src, count(*) AS info_questions
FROM "ChallengeVersion", jsonb_array_elements("questions") q
WHERE q->>'type' = 'info'
UNION ALL
SELECT 'FormVersion', count(*)
FROM "FormVersion", jsonb_array_elements("questions") q
WHERE q->>'type' = 'info';

-- ============================================================================
-- 6. Comment census — D2 ThreadStore scope + D5 anchor-remap workload
--    (anchored 'doc' comments are the ones needing remap; file/pagedoc keep
--    the standalone rail).
-- ============================================================================
SELECT "targetType",
       count(*)                                        AS comments,
       count(*) FILTER (WHERE "parentId" IS NULL)      AS threads,
       count(*) FILTER (WHERE "anchor" IS NOT NULL)    AS anchored,
       count(*) FILTER (WHERE "resolvedAt" IS NOT NULL) AS resolved
FROM "DocComment"
GROUP BY 1
ORDER BY 2 DESC;

-- ============================================================================
-- 7. Page visibility — external blast radius: publicVisible pages feed
--    dali.website (public-api renderer rewrite), partnerVisible pages are
--    read by partner accounts (readOnly connections).
-- ============================================================================
SELECT count(*)                                    AS pages,
       count(*) FILTER (WHERE "publicVisible")     AS public_dali_website,
       count(*) FILTER (WHERE "partnerVisible")    AS partner_visible,
       count(*) FILTER (WHERE "profileVisible")    AS profile_visible,
       count(*) FILTER (WHERE "contentDocId" IS NOT NULL) AS custom_doc_ref
FROM "Page";

-- ============================================================================
-- 8. Largest docs + version-history volume — conversion perf targets, BlockNote
--    large-doc exposure, and how much snapshot data goes legacy-format.
-- ============================================================================
SELECT c.name,
       octet_length(c.state)   AS state_bytes,
       length(v."plainText")   AS latest_plaintext_chars,
       v."createdAt"::date     AS last_snapshot
FROM "CollabDocument" c
LEFT JOIN LATERAL (
  SELECT "plainText", "createdAt"
  FROM "CollabDocumentVersion" WHERE name = c.name
  ORDER BY "createdAt" DESC LIMIT 1
) v ON true
ORDER BY state_bytes DESC
LIMIT 20;

SELECT count(*)                                            AS snapshots,
       count(DISTINCT name)                                AS docs_with_history,
       pg_size_pretty(sum(octet_length(state))::bigint)    AS total_snapshot_size
FROM "CollabDocumentVersion";

-- ============================================================================
-- 9. Text-only verification — hiring rooms must contain no rich nodes
--    (expect ZERO rows; any hit means the "trivial conversion" assumption is
--    wrong for that doc).
-- ============================================================================
SELECT name
FROM "CollabDocument"
WHERE split_part(name, ':', 1) IN ('review', 'interview', 'domainApplication')
  AND (position(convert_to('image','UTF8')    in state) > 0
    OR position(convert_to('tableRow','UTF8') in state) > 0
    OR position(convert_to('callout','UTF8')  in state) > 0
    OR position(convert_to('toggleBlock','UTF8') in state) > 0);

-- ============================================================================
-- 10. Mention exposure — docs whose mention notifications must not re-fire
--     after conversion (dedup list is per-doc state).
-- ============================================================================
SELECT count(*) AS docs_with_mention_notifications
FROM "CollabDocument"
WHERE cardinality("notifiedMentionUserIds") > 0;

-- ============================================================================
-- 11. Non-collab transcode workload — row counts per Phase 5/6 column.
-- ============================================================================
SELECT 'MentorNote' AS tbl, count(*) AS rows FROM "MentorNote"
UNION ALL SELECT 'MentorNoteTemplate', count(*) FROM "MentorNoteTemplate"
UNION ALL SELECT 'PageDoc', count(*) FROM "PageDoc"
UNION ALL SELECT 'ChallengeVersion (with description)', count(*) FROM "ChallengeVersion" WHERE "description" IS NOT NULL
UNION ALL SELECT 'SigningDocumentVersion', count(*) FROM "SigningDocumentVersion"
UNION ALL SELECT 'PartnerApplicationDomain (expectedChallenges)', count(*) FROM "PartnerApplicationDomain" WHERE "expectedChallenges" IS NOT NULL;
