-- CreateTable
CREATE TABLE "UserEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserEmail_address_key" ON "UserEmail"("address");

-- CreateIndex
CREATE INDEX "UserEmail_userId_idx" ON "UserEmail"("userId");

-- AddForeignKey
ALTER TABLE "UserEmail" ADD CONSTRAINT "UserEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every address already on a User row becomes a resolvable alias.
--
-- This runs IN the migration rather than as a follow-up script because the
-- sign-in resolver reads this table. An empty table between deploy and script
-- would fail every lookup, which is the outage this change exists to fix.
--
-- Priority order matters only for collisions: the same string can legitimately
-- appear in two different columns on two different rows (User.email on one,
-- User.personalEmail on another), and `address` is globally unique here. The
-- canonical column claims it first and the rest are skipped, so the migration
-- can't fail on pre-existing duplicates. Those collisions are a real data
-- conflict, surfaced by the sweep rather than silently resolved here.
--
-- verifiedAt mirrors User.emailVerified onto the canonical address only. That
-- flag came from the BetterAuth cutover backfill rather than from anyone
-- proving an inbox, so it is carried over as-is and never invented for the
-- alias columns, which stay unproven until a code sent to them is used.
INSERT INTO "UserEmail" ("id", "userId", "address", "verifiedAt", "createdAt")
SELECT gen_random_uuid()::text, "id", lower(btrim("email")),
       CASE WHEN "emailVerified" THEN CURRENT_TIMESTAMP ELSE NULL END,
       CURRENT_TIMESTAMP
FROM "User" WHERE "email" IS NOT NULL AND btrim("email") <> ''
ON CONFLICT ("address") DO NOTHING;

INSERT INTO "UserEmail" ("id", "userId", "address", "verifiedAt", "createdAt")
SELECT gen_random_uuid()::text, "id", lower(btrim("daliEmail")), NULL, CURRENT_TIMESTAMP
FROM "User" WHERE "daliEmail" IS NOT NULL AND btrim("daliEmail") <> ''
ON CONFLICT ("address") DO NOTHING;

INSERT INTO "UserEmail" ("id", "userId", "address", "verifiedAt", "createdAt")
SELECT gen_random_uuid()::text, "id", lower(btrim("dartmouthEmail")), NULL, CURRENT_TIMESTAMP
FROM "User" WHERE "dartmouthEmail" IS NOT NULL AND btrim("dartmouthEmail") <> ''
ON CONFLICT ("address") DO NOTHING;

INSERT INTO "UserEmail" ("id", "userId", "address", "verifiedAt", "createdAt")
SELECT gen_random_uuid()::text, "id", lower(btrim("personalEmail")), NULL, CURRENT_TIMESTAMP
FROM "User" WHERE "personalEmail" IS NOT NULL AND btrim("personalEmail") <> ''
ON CONFLICT ("address") DO NOTHING;
