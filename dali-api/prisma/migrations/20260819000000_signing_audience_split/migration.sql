-- Split the SigningDocument audience "ActiveMembers" (all active non-staff
-- members) into two finer cohorts:
--   * NewMembers — this cycle's incoming hires (latest General/Fellowship accepts)
--   * Members    — active members who are NOT new (the returning cohort)
--
-- Postgres cannot drop an in-use enum value, so recreate the type. Existing
-- ActiveMembers documents map to Members (returning). DATA MIGRATION: any
-- agreement previously targeting all active members now targets returning
-- members only; new members are covered by a dedicated NewMembers agreement.
BEGIN;

CREATE TYPE "SigningAudience_new" AS ENUM ('Manual', 'NewMembers', 'Members', 'Mentors', 'HiringParticipants');

ALTER TABLE "SigningDocument" ALTER COLUMN "audience" DROP DEFAULT;

ALTER TABLE "SigningDocument"
  ALTER COLUMN "audience" TYPE "SigningAudience_new"
  USING (
    CASE "audience"::text
      WHEN 'ActiveMembers' THEN 'Members'
      ELSE "audience"::text
    END::"SigningAudience_new"
  );

ALTER TYPE "SigningAudience" RENAME TO "SigningAudience_old";
ALTER TYPE "SigningAudience_new" RENAME TO "SigningAudience";
DROP TYPE "SigningAudience_old";

ALTER TABLE "SigningDocument" ALTER COLUMN "audience" SET DEFAULT 'Manual';

COMMIT;
