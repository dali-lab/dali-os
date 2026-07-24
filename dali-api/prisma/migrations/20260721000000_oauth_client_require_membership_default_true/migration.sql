-- Fail closed: a client provisioned without an explicit requireMembership now
-- defaults to true, so a non-member can't reach the MCP surface. Existing rows
-- are unchanged (the only production client already sets this to true).

-- AlterTable
ALTER TABLE "OAuthClient" ALTER COLUMN "requireMembership" SET DEFAULT true;
