-- Reminder throttle for the agreements console: last time a Core member nudged
-- this binding's outstanding signers. Additive + nullable — no backfill, no data loss.
ALTER TABLE "SigningBinding" ADD COLUMN "lastRemindedAt" TIMESTAMP(3);
