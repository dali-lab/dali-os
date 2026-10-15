-- One Page (kind Form) per existing Form, sharing the form's id. Placement
-- comes from the form's folder when that folder is live; otherwise the form
-- lands at the Lab root, where the Drive already surfaced orphaned forms. The
-- fill audience maps onto General access (fill = View): Public -> Public,
-- Members -> LabMembers, SignedIn -> SignedIn, Groups -> Restricted plus one
-- group share per selected group. Idempotent: re-running inserts nothing.
INSERT INTO "Page" (
  "id", "workspaceType", "workspaceId", "parentPageId", "title", "kind",
  "position", "createdById", "lastEditedById", "archivedAt",
  "linkAccess", "linkPermission", "createdAt", "updatedAt"
)
SELECT
  f."id",
  COALESCE(p."workspaceType", 'Lab'::"WorkspaceType"),
  p."workspaceId",
  p."id",
  f."name",
  'Form'::"PageKind",
  0,
  f."createdById",
  f."createdById",
  f."archivedAt",
  CASE f."audience"
    WHEN 'Public' THEN 'Public'::"LinkAccess"
    WHEN 'Members' THEN 'LabMembers'::"LinkAccess"
    WHEN 'SignedIn' THEN 'SignedIn'::"LinkAccess"
    ELSE 'Restricted'::"LinkAccess"
  END,
  'View'::"SharePermission",
  f."createdAt",
  f."updatedAt"
FROM "Form" f
LEFT JOIN "Page" p
  ON p."id" = f."folderPageId" AND p."kind" = 'Folder' AND p."archivedAt" IS NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "PageShare" ("id", "pageId", "principalType", "principalId", "permission", "createdById", "createdAt")
SELECT
  md5(f."id" || ':' || g.gid),
  f."id",
  'Group'::"SharePrincipalType",
  g.gid,
  'View'::"SharePermission",
  f."createdById",
  now()
FROM "Form" f
CROSS JOIN LATERAL unnest(f."audienceGroupIds") AS g(gid)
WHERE f."audience" = 'Groups'
ON CONFLICT ("pageId", "principalType", "principalId") DO NOTHING;

-- Every Form now has its Page, so the shared-id relation can be enforced.
ALTER TABLE "Form" ADD CONSTRAINT "Form_id_fkey"
  FOREIGN KEY ("id") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
