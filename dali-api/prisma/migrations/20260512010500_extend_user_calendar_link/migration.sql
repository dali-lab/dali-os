-- Drop the old single-account unique constraint on userId.
DROP INDEX "UserCalendarLink_userId_key";

-- New columns. All nullable or with defaults — safe.
ALTER TABLE "UserCalendarLink"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "syncError" TEXT;

-- Allow multiple links per user, unique per (user, provider, externalEmail).
CREATE UNIQUE INDEX "UserCalendarLink_userId_provider_externalEmail_key"
  ON "UserCalendarLink"("userId", "provider", "externalEmail");

CREATE INDEX "UserCalendarLink_userId_idx" ON "UserCalendarLink"("userId");
