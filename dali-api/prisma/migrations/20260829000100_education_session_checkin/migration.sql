-- When an instructor opens self-check-in for a session, students scan a
-- projected QR to mark themselves Present. Additive + nullable: no backfill,
-- safe on a populated table. Null = check-in closed. See
-- app/education/lib/session-checkin.server.ts.
-- AlterTable
ALTER TABLE "EducationSession" ADD COLUMN     "checkInOpenAt" TIMESTAMP(3);
