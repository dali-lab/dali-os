-- Hiring's emails become one shared, unversioned email per slot, used by every
-- cycle and edited in place ("HiringEmail"), instead of each cycle binding a
-- version of an Email Templates library template per slot.
--
-- DATA-LOSING: drops "CycleDecisionEmail" and "CycleNotificationEmail". Each
-- slot is seeded first with the subject and body bound on the most recently
-- created cycle that bound it, so the emails in use today carry over. The
-- Email Templates library itself (still used by Education and admin) is
-- untouched.

-- CreateTable
CREATE TABLE "HiringEmail" (
    "slot" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "HiringEmail_pkey" PRIMARY KEY ("slot")
);

-- Seed each slot from its most recent cycle binding
INSERT INTO "HiringEmail" ("slot", "subject", "body", "updatedAt")
SELECT DISTINCT ON (slot) slot, subject, body, CURRENT_TIMESTAMP
FROM (
  SELECT 'decision:' || b."decisionType"::text AS slot, v."subject", v."body", c."createdAt"
  FROM "CycleDecisionEmail" b
  JOIN "ApplicationCycle" c ON c."id" = b."applicationCycleId"
  JOIN "EmailTemplateVersion" v ON v."id" = b."emailTemplateVersionId"
  UNION ALL
  SELECT 'notification:' || b."notificationType"::text AS slot, v."subject", v."body", c."createdAt"
  FROM "CycleNotificationEmail" b
  JOIN "ApplicationCycle" c ON c."id" = b."applicationCycleId"
  JOIN "EmailTemplateVersion" v ON v."id" = b."emailTemplateVersionId"
) AS bound
ORDER BY slot, "createdAt" DESC;

-- AddForeignKey
ALTER TABLE "HiringEmail" ADD CONSTRAINT "HiringEmail_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropTable
DROP TABLE "CycleDecisionEmail";
DROP TABLE "CycleNotificationEmail";
