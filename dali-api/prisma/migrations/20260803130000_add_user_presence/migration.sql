-- Persistent presence: track last activity time and allow users to appear away.
-- Both columns are additive (nullable / defaulted) — safe on populated tables.
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "hideActivity" BOOLEAN NOT NULL DEFAULT false;
