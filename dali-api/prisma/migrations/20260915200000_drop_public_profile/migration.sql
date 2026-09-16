-- The public team directory now scopes to staffed members (anyone with a
-- project or core assignment) in the query itself, replacing the opt-in
-- `publicProfile` flag that nothing maintained (backfilled once, so members
-- added afterward never appeared). See app/public-api/lib/public-team.server.ts.
--
-- Data-losing by design: the flag's meaning ("staffed member") is derivable
-- from the assignment tables, so no information is actually lost.

-- AlterTable
ALTER TABLE "User" DROP COLUMN "publicProfile";
