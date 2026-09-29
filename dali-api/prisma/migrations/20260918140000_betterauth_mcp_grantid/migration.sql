-- Phase 4 (BetterAuth MCP provider): add grantId to AuthSession so MCP-issued
-- BetterAuth sessions can be traced back to the OAuthGrant that authorized
-- them. The column is nullable (normal browser sessions have no grant).
-- No FK constraint — authenticateMcpRequest looks up OAuthGrant.id separately,
-- same as the bespoke Session path.

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "grantId" TEXT;

-- CreateIndex
CREATE INDEX "AuthSession_grantId_idx" ON "AuthSession"("grantId");
