-- One live shortcut to a given target per folder. Prisma can't express a
-- partial or expression index, so it lives here in raw SQL (same approach as
-- Page_process_folder_type_live). The COALESCEs make top-level placements
-- (NULL parentPageId) and Lab placements (NULL workspaceId) collide, which a
-- plain column list would treat as distinct.
CREATE UNIQUE INDEX "Page_shortcut_target_parent_live"
  ON "Page" ("targetPageId", "workspaceType", COALESCE("workspaceId", ''), COALESCE("parentPageId", ''))
  WHERE "kind" = 'Shortcut' AND "archivedAt" IS NULL;
