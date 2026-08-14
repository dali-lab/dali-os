-- Resume / portfolio stats for DALI OS.
--
-- Run against the PROD database (the only env that carries real history —
-- staging/dev are rebuilt each deploy). Non-pooled endpoint recommended:
--   psql "$DIRECT_URL" -f scripts/resume-stats.sql
-- Every block is a standalone SELECT; run the ones you need.
--
-- Definitions used throughout:
--   * "lab member" = a User that has a DALIMember row. This is what excludes
--     applicants / partners / interviewers, who are Users too. Always join
--     DALIMember to scope a metric to "the lab".
--   * effective membership status = COALESCE(membershipStatusOverride,
--     membershipStatus) — the override wins when set.
--
-- Retention caveats (matter for trailing-window queries):
--   * AuditLog is retained FOREVER (login.success, mcp.tool_called live here).
--   * PageView has BOUNDED retention (product telemetry). Great for recent
--     WAU/MAU; do NOT trust it for all-time history.


-- ════════════════════════════════════════════════════════════════════════════
-- STAT 1 — PLATFORM: active usage as a fraction of the lab
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. Denominator: how big is "the lab" right now.
SELECT
  count(*) FILTER (
    WHERE COALESCE(u."membershipStatusOverride", u."membershipStatus") = 'Active'
  )                                                    AS active_members,   -- the "~120"
  count(*)                                             AS members_all_time  -- incl. alumni
FROM "User" u
JOIN "DALIMember" m ON m."userId" = u.id;


-- 1b. HEADLINE: weekly / monthly active members as a fraction of the lab.
-- Primary signal = PageView (fires on every authenticated navigation).
WITH active_members AS (
  SELECT u.id
  FROM "User" u
  JOIN "DALIMember" m ON m."userId" = u.id
  WHERE COALESCE(u."membershipStatusOverride", u."membershipStatus") = 'Active'
)
SELECT
  (SELECT count(*) FROM active_members)                                      AS active_members,
  count(DISTINCT pv."userId") FILTER (WHERE pv."createdAt" >= now() - interval '7 days')  AS weekly_active,
  count(DISTINCT pv."userId") FILTER (WHERE pv."createdAt" >= now() - interval '30 days') AS monthly_active,
  round(100.0 * count(DISTINCT pv."userId") FILTER (WHERE pv."createdAt" >= now() - interval '7 days')
        / NULLIF((SELECT count(*) FROM active_members), 0), 1)              AS pct_weekly,
  round(100.0 * count(DISTINCT pv."userId") FILTER (WHERE pv."createdAt" >= now() - interval '30 days')
        / NULLIF((SELECT count(*) FROM active_members), 0), 1)             AS pct_monthly
FROM "PageView" pv
WHERE pv."userId" IN (SELECT id FROM active_members);


-- 1b-alt. Login-based WAU/MAU (AuditLog is retained forever — use this to
-- quote a historical window, or to sanity-check the PageView number).
SELECT
  count(DISTINCT a."userId") FILTER (WHERE a."createdAt" >= now() - interval '7 days')  AS wau_logins,
  count(DISTINCT a."userId") FILTER (WHERE a."createdAt" >= now() - interval '30 days') AS mau_logins
FROM "AuditLog" a
JOIN "DALIMember" m ON m."userId" = a."userId"
WHERE a.action = 'login.success';


-- 1b-alt2. "Seen recently" via rolling session use (one row per session).
SELECT count(DISTINCT s."userId") AS members_seen_last_7d
FROM "Session" s
JOIN "DALIMember" m ON m."userId" = s."userId"
WHERE s."lastUsedAt" >= now() - interval '7 days'
  AND s."revokedAt" IS NULL;


-- 1b-series. Monthly active members over time — pick the best month to quote.
-- (PageView-based; only as far back as telemetry retention allows.)
SELECT
  date_trunc('month', pv."createdAt")::date AS month,
  count(DISTINCT pv."userId")               AS monthly_active_members
FROM "PageView" pv
JOIN "DALIMember" m ON m."userId" = pv."userId"
GROUP BY 1
ORDER BY 1;

-- 1b-reach. How far back does PageView (bounded retention) actually go? If the
-- earliest row predates a full academic term, 1b-series already has your peak.
SELECT
  min("createdAt")::date AS earliest_pageview,
  max("createdAt")::date AS latest_pageview
FROM "PageView";


-- ── PEAK-TERM numbers (use these for the resume — the trailing-window queries
--    above land in the summer trough when ~75% of the lab is off-term). These
--    use login.success in AuditLog, which is retained FOREVER, so they reach
--    all the way back to launch and surface the fall/winter/spring peaks.

-- 1b-peak-week. Busiest weeks ever, by distinct members who logged in.
-- The top row is your honest "used weekly by N of ~120" number.
SELECT
  date_trunc('week', a."createdAt")::date AS week,
  count(DISTINCT a."userId")              AS active_members
FROM "AuditLog" a
JOIN "DALIMember" m ON m."userId" = a."userId"
WHERE a.action = 'login.success'
GROUP BY 1
ORDER BY active_members DESC
LIMIT 10;

-- 1b-peak-month. Same, by month — the honest MAU peak.
SELECT
  date_trunc('month', a."createdAt")::date AS month,
  count(DISTINCT a."userId")               AS active_members
FROM "AuditLog" a
JOIN "DALIMember" m ON m."userId" = a."userId"
WHERE a.action = 'login.success'
GROUP BY 1
ORDER BY active_members DESC
LIMIT 12;

-- NOTE: login.success UNDERCOUNTS active users — a rolling session keeps
-- someone signed in for up to 30 days on one login, so during a busy term the
-- true active count is >= these numbers. Quote them as a floor.


-- 1c. Time in continuous production.
-- DO NOT anchor this on AuditLog: login.success only goes back to when
-- audit-logging was switched on (April 2026 in prod), NOT to launch. Anchor on
-- the earliest USER-GENERATED record instead. DALI OS started as the hiring
-- platform, so the first Application / ApplicationCycle is the true launch mark.
-- Run this and take the MIN of the real-data rows as your production start.
SELECT 'ApplicationCycle' AS source, min("createdAt")::date AS earliest FROM "ApplicationCycle"
UNION ALL SELECT 'Application',       min("createdAt")::date FROM "Application"
UNION ALL SELECT 'Decision',          min("createdAt")::date FROM "Decision"
UNION ALL SELECT 'User',              min("createdAt")::date FROM "User"
UNION ALL SELECT 'DALIMember',        min("createdAt")::date FROM "DALIMember"
UNION ALL SELECT 'CollabDocumentVersion', min("createdAt")::date FROM "CollabDocumentVersion"
UNION ALL SELECT 'Session',           min("createdAt")::date FROM "Session"
UNION ALL SELECT 'AuditLog',          min("createdAt")::date FROM "AuditLog"
ORDER BY earliest;

-- 1c-years. Once you know the launch date from 1c, plug it in here.
SELECT
  (now()::date - DATE '2025-08-01')                  AS days_in_production,
  round((now()::date - DATE '2025-08-01') / 365.0, 2) AS years_in_production;


-- ════════════════════════════════════════════════════════════════════════════
-- STAT 2 — REALTIME COLLAB: documents synced + peak concurrent editors
-- ════════════════════════════════════════════════════════════════════════════

-- 2a. Total documents synced through the CRDT backend. CollabDocument is every
-- Yjs-backed doc: Notion-style page bodies, bios, task descriptions, mentor
-- notes, etc. — the "everything runs on the CRDT engine" number.
SELECT count(*) AS collab_documents FROM "CollabDocument";

-- 2a-detail. Break the number down into legible slices.
SELECT
  (SELECT count(*) FROM "CollabDocument")                              AS crdt_docs_total,
  (SELECT count(DISTINCT name) FROM "CollabDocumentVersion")           AS docs_ever_edited,   -- accrued >=1 snapshot
  (SELECT count(*) FROM "Page" WHERE "kind" <> 'Folder'
                                 AND "archivedAt" IS NULL)             AS notion_pages_live,  -- user-facing pages
  (SELECT count(*) FROM "Page" WHERE "kind" <> 'Folder')              AS notion_pages_all;


-- 2b. PEAK concurrent editors on a single document. authorIds on each ~30s
-- snapshot = the userIds that edited within that window, so max cardinality is
-- a (conservative) floor on simultaneous editors — the number that justifies
-- Redis fan-out across instances.
SELECT max(cardinality("authorIds")) AS peak_simultaneous_editors_one_doc
FROM "CollabDocumentVersion";

-- 2b-top. Busiest documents by peak concurrency.
SELECT
  name,
  max(cardinality("authorIds")) AS peak_concurrent_editors,
  count(*)                       AS snapshots
FROM "CollabDocumentVersion"
GROUP BY name
ORDER BY peak_concurrent_editors DESC, snapshots DESC
LIMIT 20;

-- 2b-multi. How many docs ever had 2+ people editing at once (proves the
-- fan-out mattered, not just that it exists).
SELECT count(*) AS docs_with_simultaneous_editing
FROM (
  SELECT name
  FROM "CollabDocumentVersion"
  GROUP BY name
  HAVING max(cardinality("authorIds")) >= 2
) t;

-- 2b-fanout. PLATFORM-WIDE peak: how many editing sessions were live at once
-- across ALL documents during the busiest stretch. This is the concurrent load
-- Redis fan-out actually carries (vs 2b, which is per-single-doc). Each version
-- snapshot (~every 30s of active editing) carries the userIds that edited since
-- the last one, so a 1-minute bucket ≈ "editing right now". Top row = peak.
SELECT
  date_trunc('minute', v."createdAt")  AS minute,
  count(DISTINCT (a, v.name))          AS editing_sessions,   -- person×doc pairs live at once
  count(DISTINCT a)                    AS distinct_editors,    -- distinct people editing
  count(DISTINCT v.name)               AS docs_active
FROM "CollabDocumentVersion" v,
     LATERAL unnest(v."authorIds") AS a
GROUP BY 1
ORDER BY editing_sessions DESC
LIMIT 15;

-- 2b-total. Total distinct contributors on the most collaborative docs.
SELECT
  v.name,
  count(DISTINCT a) AS total_distinct_editors
FROM "CollabDocumentVersion" v,
     LATERAL unnest(v."authorIds") AS a
GROUP BY v.name
ORDER BY total_distinct_editors DESC
LIMIT 20;


-- ════════════════════════════════════════════════════════════════════════════
-- STAT 3 — MCP / OAUTH: adoption of the AI-assistant connector
-- ════════════════════════════════════════════════════════════════════════════

-- 3a. HEADLINE: distinct members who connected an AI assistant. One OAuthGrant
-- row per (member, client); currently-connected excludes revoked grants.
SELECT
  count(DISTINCT "userId") FILTER (WHERE "revokedAt" IS NULL)      AS members_connected_now,
  count(DISTINCT "userId")                                         AS members_ever_connected,
  count(DISTINCT "userId") FILTER (WHERE "lastUsedAt" IS NOT NULL) AS members_who_actually_used_it
FROM "OAuthGrant";

-- 3a-byclient. Which assistant they connected (Claude Desktop, Claude Code, …).
SELECT
  c.name                        AS client,
  count(DISTINCT g."userId")    AS distinct_members,
  count(*)                      AS grants,
  count(*) FILTER (WHERE g."revokedAt" IS NULL) AS active_grants
FROM "OAuthGrant" g
JOIN "OAuthClient" c ON c."clientId" = g."clientId"
GROUP BY c.name
ORDER BY distinct_members DESC;


-- 3b. Tool-call volume run through the MCP server (AuditLog, retained forever).
SELECT
  count(*)                  AS total_tool_calls,
  count(DISTINCT "userId")  AS distinct_callers,
  min("createdAt")::date    AS first_call,
  max("createdAt")::date    AS last_call
FROM "AuditLog"
WHERE action = 'mcp.tool_called';

-- 3b-all. All MCP surface activity (tool calls + resource reads + prompts).
SELECT
  action,
  count(*)                 AS events,
  count(DISTINCT "userId") AS distinct_users
FROM "AuditLog"
WHERE action IN ('mcp.tool_called', 'mcp.resource_read', 'mcp.prompt_rendered')
GROUP BY action
ORDER BY events DESC;

-- 3b-top. Most-used MCP tools (toolName lives in AuditLog.metadata).
SELECT
  metadata->>'toolName'    AS tool,
  count(*)                 AS calls,
  count(DISTINCT "userId") AS distinct_users
FROM "AuditLog"
WHERE action = 'mcp.tool_called'
GROUP BY 1
ORDER BY calls DESC
LIMIT 25;
