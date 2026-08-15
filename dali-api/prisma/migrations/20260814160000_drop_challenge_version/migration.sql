-- Retire the bespoke Challenge/ChallengeVersion system: every hiring question
-- set now lives as a Drive Form. This converts ALL remaining ChallengeVersion
-- data → Form + FormVersion, backfills the Form-based columns, then drops the
-- legacy tables + FK columns. After this, hiring reads only Forms.
--
-- Deterministic ids ('form_cv_'/'fv_cv_' + source id) let the backfills join.

-- 1. One Form + v1 FormVersion per ChallengeVersion (general or per-domain).
INSERT INTO "Form" ("id", "name", "createdAt", "updatedAt", "createdById")
SELECT 'form_cv_' || cv."id",
       COALESCE(c."name", 'Challenge')
         || CASE WHEN cv."domainId" IS NULL THEN ' (general form)' ELSE ' (challenge)' END,
       cv."createdAt", CURRENT_TIMESTAMP, cv."createdById"
FROM "ChallengeVersion" cv
JOIN "Challenge" c ON c."id" = cv."challengeId"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "FormVersion" ("id", "createdAt", "versionNumber", "questions", "intro", "formId", "createdById")
SELECT 'fv_cv_' || cv."id", cv."createdAt", 1, cv."questions",
       CASE WHEN cv."description" IS NULL THEN NULL ELSE cv."description"::text END,
       'form_cv_' || cv."id", cv."createdById"
FROM "ChallengeVersion" cv
ON CONFLICT ("id") DO NOTHING;

-- 2. General form: bind each cycle's applicationFormId to the general CV linked
-- to it (domainId IS NULL), unless already bound.
UPDATE "ApplicationCycle" ac
SET "applicationFormId" = 'form_cv_' || cvac."challengeVersionId"
FROM "ChallengeVersionApplicationCycle" cvac
JOIN "ChallengeVersion" cv ON cv."id" = cvac."challengeVersionId"
WHERE cvac."applicationCycleId" = ac."id"
  AND cv."domainId" IS NULL
  AND ac."applicationFormId" IS NULL;

-- 3. Backfill Application.applicationFormVersionId from generalChallengeVersionId.
UPDATE "Application" a
SET "applicationFormVersionId" = 'fv_cv_' || a."generalChallengeVersionId"
WHERE a."generalChallengeVersionId" IS NOT NULL
  AND a."applicationFormVersionId" IS NULL;

-- 4. Per-domain challenges: a CycleDomainForm row per (cycle, domain, form)
-- for every per-domain ChallengeVersion linked to a cycle.
INSERT INTO "CycleDomainForm" ("id", "createdAt", "applicationCycleId", "domainId", "formId")
SELECT 'cdf_' || cvac."challengeVersionId" || '_' || cvac."applicationCycleId",
       CURRENT_TIMESTAMP, cvac."applicationCycleId", cv."domainId", 'form_cv_' || cvac."challengeVersionId"
FROM "ChallengeVersionApplicationCycle" cvac
JOIN "ChallengeVersion" cv ON cv."id" = cvac."challengeVersionId"
WHERE cv."domainId" IS NOT NULL
ON CONFLICT ("applicationCycleId", "domainId", "formId") DO NOTHING;

-- 5. Backfill DomainApplication.challengeFormVersionId from challengeVersionId.
UPDATE "DomainApplication" da
SET "challengeFormVersionId" = 'fv_cv_' || da."challengeVersionId"
WHERE da."challengeVersionId" IS NOT NULL
  AND da."challengeFormVersionId" IS NULL;

-- 6. Drop legacy FK columns, the join table, and the challenge tables.
ALTER TABLE "Application" DROP CONSTRAINT "Application_generalChallengeVersionId_fkey";
ALTER TABLE "Application" DROP COLUMN "generalChallengeVersionId";
ALTER TABLE "DomainApplication" DROP CONSTRAINT "DomainApplication_challengeVersionId_fkey";
ALTER TABLE "DomainApplication" DROP COLUMN "challengeVersionId";
DROP TABLE "ChallengeVersionApplicationCycle";
DROP TABLE "ChallengeVersion";
DROP TABLE "Challenge";
