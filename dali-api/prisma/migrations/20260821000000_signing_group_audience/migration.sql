-- Add a "Group" SigningDocument audience: an agreement can target a user group
-- (SigningDocument.audienceGroupId, a GroupDefinition id resolved through
-- resolveGroupMembers). A null audienceGroupId with audience=Group means "the
-- binding's term group", so a per-term agreement auto-rolls to each term's
-- active-member roster (everyone staffed that term) instead of blasting every
-- active member including those off-campus / off-term.
--
-- Postgres cannot add an enum value inside a transaction that later depends on
-- it, so recreate the type (the pattern this repo already uses for
-- SigningAudience — see 20260819000000_signing_audience_split). Additive only:
-- existing values map to themselves.
BEGIN;

CREATE TYPE "SigningAudience_new" AS ENUM ('Manual', 'NewMembers', 'Members', 'Mentors', 'HiringParticipants', 'Group');

ALTER TABLE "SigningDocument" ALTER COLUMN "audience" DROP DEFAULT;

ALTER TABLE "SigningDocument"
  ALTER COLUMN "audience" TYPE "SigningAudience_new"
  USING ("audience"::text::"SigningAudience_new");

ALTER TYPE "SigningAudience" RENAME TO "SigningAudience_old";
ALTER TYPE "SigningAudience_new" RENAME TO "SigningAudience";
DROP TYPE "SigningAudience_old";

ALTER TABLE "SigningDocument" ALTER COLUMN "audience" SET DEFAULT 'Manual';

-- Target group for audience=Group; null = the binding's term group (auto-roll).
ALTER TABLE "SigningDocument" ADD COLUMN "audienceGroupId" TEXT;

COMMIT;
