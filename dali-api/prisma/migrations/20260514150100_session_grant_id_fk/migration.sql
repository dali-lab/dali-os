-- MCP foundation: enforce the FK from Session.grantId to OAuthGrant.id at
-- the DB level. Prisma already declares the relation; this migration adds
-- the constraint that backs it. Existing rows have grantId = NULL so no
-- backfill required.

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "OAuthGrant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
