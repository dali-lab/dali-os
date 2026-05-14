-- MCP foundation: per-request client + scope tracking on OAuthSession.
-- Both columns are nullable / default-empty so existing rows remain valid.

ALTER TABLE "OAuthSession"
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
