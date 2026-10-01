-- Collapse three email-template stores into one keyed by registry key.
--
-- Before: a versioned "EmailTemplate" library that NO send site read (verified:
-- zero production readers; its only runtime effect was a self-addressed test
-- send), plus "HiringEmail" and "EducationEmail", byte-identical in shape, each
-- keyed on a bare slot. The slot namespaces collided — "decision:Rejected"
-- existed in both — which is why the unified key is the slot prefixed with its
-- area.
--
-- DATA LOSS, deliberate and scoped:
--   * Rows in the old EmailTemplate / EmailTemplateVersion library are dropped.
--     Nothing read them, the list route has redirected away from them since the
--     cycle-timeline rebuild, and there is no key to migrate them onto — a
--     library template was never bound to anything.
--   * HiringEmail and EducationEmail rows are MIGRATED, not dropped. Their
--     subject/body/updatedAt/updatedById carry over, which is the operator copy
--     that actually ships today.
--
-- Version history intentionally starts empty rather than being backfilled:
-- EmailTemplateVersion.createdById is NOT NULL while HiringEmail.updatedById is
-- nullable, so a synthetic first version would need a fabricated author. History
-- begins at the first save after this migration.

-- 1. Stash the live copy before anything is dropped.
CREATE TEMP TABLE _email_copy_carry (
  key         TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT
);

INSERT INTO _email_copy_carry (key, subject, body, "updatedAt", "updatedById")
SELECT 'hiring:' || slot, subject, body, "updatedAt", "updatedById"
FROM "HiringEmail";

INSERT INTO _email_copy_carry (key, subject, body, "updatedAt", "updatedById")
SELECT 'education:' || slot, subject, body, "updatedAt", "updatedById"
FROM "EducationEmail"
ON CONFLICT (key) DO NOTHING;

-- 2. Drop the old library (child first) and the two slot tables.
DROP TABLE "EmailTemplateVersion";
DROP TABLE "EmailTemplate";
DROP TABLE "HiringEmail";
DROP TABLE "EducationEmail";

-- 3. The unified store.
CREATE TABLE "EmailTemplate" (
  "key"         TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,

  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "EmailTemplateVersion" (
  "id"            TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "versionNumber" INTEGER NOT NULL,
  "subject"       TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "templateKey"   TEXT NOT NULL,
  "createdById"   TEXT NOT NULL,

  CONSTRAINT "EmailTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailTemplateVersion_templateKey_versionNumber_idx"
  ON "EmailTemplateVersion"("templateKey", "versionNumber");

ALTER TABLE "EmailTemplate"
  ADD CONSTRAINT "EmailTemplate_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailTemplateVersion"
  ADD CONSTRAINT "EmailTemplateVersion_templateKey_fkey"
  FOREIGN KEY ("templateKey") REFERENCES "EmailTemplate"("key") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailTemplateVersion"
  ADD CONSTRAINT "EmailTemplateVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Restore the carried copy.
INSERT INTO "EmailTemplate" ("key", "subject", "body", "updatedAt", "updatedById")
SELECT key, subject, body, "updatedAt", "updatedById" FROM _email_copy_carry;

DROP TABLE _email_copy_carry;
