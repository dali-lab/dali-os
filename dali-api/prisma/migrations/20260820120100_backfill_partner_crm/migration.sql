-- Account-first partner CRM — data backfill.
-- Runs after 20260820120000 has committed, so the new PartnerApplicationStatus
-- values ('ApplicationSubmitted', 'Promoted', 'Inquiry') are safe to use here.
-- Migrates the deprecated org-first PartnerUser rows into the account-first
-- PartnerContact + PartnerMembership model, then fills applicantContactId and
-- remaps statuses. PartnerUser itself is left intact (dropped in a later PR)
-- for a rollback window.

-- 1. One PartnerContact per existing PartnerUser (the account primitive).
--    id = 'pc_' || PartnerUser.id (deterministic). Email comes from the User's
--    personalEmail (unique on User → no collisions); null/blank falls back to a
--    tagged placeholder so the unique+required email is always satisfiable.
INSERT INTO "PartnerContact" ("id", "name", "email", "userId", "authProvider", "createdAt")
SELECT
  'pc_' || pu."id",
  btrim(u."firstName" || ' ' || u."lastName"),
  COALESCE(NULLIF(lower(u."personalEmail"), ''), 'legacy+' || pu."id" || '@placeholder.invalid'),
  u."id",
  pu."authProvider",
  pu."createdAt"
FROM "PartnerUser" pu
JOIN "User" u ON u."id" = pu."userId";

-- 2. One PartnerMembership per PartnerUser. id = PartnerUser.id (reused) so any
--    PartnerOrg.primaryContactId (which stored a PartnerUser.id) already points
--    at the correct membership — no rewrite needed.
INSERT INTO "PartnerMembership" ("id", "contactId", "orgId", "role", "createdAt")
SELECT
  pu."id",
  'pc_' || pu."id",
  pu."partnerOrgId",
  pu."displayRole",
  pu."createdAt"
FROM "PartnerUser" pu;

-- 3. Synthetic contact for any org that has applications but zero members
--    (e.g. its PartnerUser was deleted) so applicantContactId can be NOT NULL.
--    Tagged placeholder email makes these findable for later cleanup.
INSERT INTO "PartnerContact" ("id", "name", "email", "userId", "createdAt")
SELECT
  'pc_org_' || o."id",
  o."name",
  'legacy+org+' || o."id" || '@placeholder.invalid',
  NULL,
  CURRENT_TIMESTAMP
FROM "PartnerOrg" o
WHERE EXISTS (SELECT 1 FROM "PartnerApplication" pa WHERE pa."partnerOrgId" = o."id")
  AND NOT EXISTS (SELECT 1 FROM "PartnerMembership" m WHERE m."orgId" = o."id");

-- 4. applicantContactId on every existing application: prefer the org's primary
--    contact, else the earliest member, else the synthetic org contact.
UPDATE "PartnerApplication" pa
SET "applicantContactId" = COALESCE(
  (
    SELECT m."contactId"
    FROM "PartnerMembership" m
    JOIN "PartnerOrg" o ON o."id" = pa."partnerOrgId"
    WHERE m."orgId" = pa."partnerOrgId"
    ORDER BY (CASE WHEN m."id" = o."primaryContactId" THEN 0 ELSE 1 END), m."createdAt" ASC
    LIMIT 1
  ),
  'pc_org_' || pa."partnerOrgId"
)
WHERE pa."partnerOrgId" IS NOT NULL
  AND pa."applicantContactId" IS NULL;

-- 5. Status remap onto the CRM funnel.
UPDATE "PartnerApplication" SET "status" = 'ApplicationSubmitted' WHERE "status" = 'Submitted';
UPDATE "PartnerApplication" SET "status" = 'Promoted'
  WHERE "status" = 'Accepted' AND "resultingProjectId" IS NOT NULL;

-- 6. Switch the new-row default now that the enum value is committed.
ALTER TABLE "PartnerApplication" ALTER COLUMN "status" SET DEFAULT 'Inquiry';
