-- Optional Core marker on a scheduled meeting, set at invite time by a Core
-- member so the meeting appears on the Core hub's week calendar regardless of
-- its participant scope. Additive and defaulted — existing rows keep today's
-- behaviour (only Core-group-scoped meetings reach the hub).

ALTER TABLE "ScheduledMeeting" ADD COLUMN "isCoreMeeting" BOOLEAN NOT NULL DEFAULT false;
