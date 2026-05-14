-- Delete the dead `claude-desktop` / `claude-code` OAuthClient seeds from
-- PR #538. They were never reachable: Claude Code's MCP SDK has no hardcoded
-- client_id for DALI OS and always uses RFC 7591 Dynamic Client Registration
-- (added in the PR that introduces this migration).
--
-- Defensive: only delete rows with NO associated OAuthGrant. If anyone
-- somehow did link a grant to these seeds, we leave the row in place rather
-- than orphan the grant.

DELETE FROM "OAuthClient"
WHERE "clientId" IN ('claude-desktop', 'claude-code')
  AND NOT EXISTS (
    SELECT 1 FROM "OAuthGrant" g WHERE g."clientId" = "OAuthClient"."clientId"
  );
