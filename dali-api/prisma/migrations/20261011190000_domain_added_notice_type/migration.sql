-- Adds the NotificationType value the "domain added" one-time announcement
-- email slot needs to be valid. Fully additive (see 20261011120000_hiring_events
-- for the same pattern with ApplicationEventAnnouncement).

-- AlterEnum
--
-- Postgres 16 allows ALTER TYPE ... ADD VALUE inside a transaction; the new
-- value just can't be *used* in that same transaction. Nothing below writes
-- a row with it, so this is safe as one migration.
ALTER TYPE "NotificationType" ADD VALUE 'DomainAddedNotice';
