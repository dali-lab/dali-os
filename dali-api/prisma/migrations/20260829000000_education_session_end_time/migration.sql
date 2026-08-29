-- Optional end time for an education session. Additive + nullable: no backfill,
-- safe on a populated table. Null falls back to a default duration in the UI
-- and the self-check-in window. See app/education (session forms, CourseHub).
-- AlterTable
ALTER TABLE "EducationSession" ADD COLUMN     "endsAt" TIMESTAMP(3);
