-- Tracks the manual "invited to Figma" onboarding step (Figma has no invite
-- API, so an admin checks this off on the onboarding board). Nullable; null
-- means not yet invited. No backfill needed.
ALTER TABLE "User" ADD COLUMN "figmaInvitedAt" TIMESTAMP(3);
