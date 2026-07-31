-- CreateEnum
CREATE TYPE "SigningDocumentKind" AS ENUM ('General', 'MemberAgreement', 'MentorshipAgreement', 'Confidentiality');

-- CreateEnum
CREATE TYPE "SigningGateScope" AS ENUM ('None', 'App', 'HiringCycle');

-- CreateEnum
CREATE TYPE "SigningAudience" AS ENUM ('Manual', 'ActiveMembers', 'Mentors', 'HiringParticipants');

-- CreateTable
CREATE TABLE "SigningDocument" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "SigningDocumentKind" NOT NULL DEFAULT 'General',
    "gateScope" "SigningGateScope" NOT NULL DEFAULT 'None',
    "audience" "SigningAudience" NOT NULL DEFAULT 'Manual',
    "letterheadImageUrl" TEXT,
    "footerText" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SigningDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningDocumentVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionNumber" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "roles" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "documentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "SigningDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningBinding" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "cycleId" TEXT,
    "termId" TEXT,

    CONSTRAINT "SigningBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningSignature" (
    "id" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bindingId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "fieldValues" JSONB NOT NULL,
    "frozenBody" JSONB,

    CONSTRAINT "SigningSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SigningDocument_slug_key" ON "SigningDocument"("slug");

-- CreateIndex
CREATE INDEX "SigningDocument_kind_idx" ON "SigningDocument"("kind");

-- CreateIndex
CREATE INDEX "SigningDocumentVersion_documentId_versionNumber_idx" ON "SigningDocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SigningDocumentVersion_documentId_versionNumber_key" ON "SigningDocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "SigningBinding_cycleId_idx" ON "SigningBinding"("cycleId");

-- CreateIndex
CREATE INDEX "SigningBinding_termId_idx" ON "SigningBinding"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "SigningBinding_documentId_scopeKey_key" ON "SigningBinding"("documentId", "scopeKey");

-- CreateIndex
CREATE INDEX "SigningSignature_signerUserId_idx" ON "SigningSignature"("signerUserId");

-- CreateIndex
CREATE INDEX "SigningSignature_versionId_idx" ON "SigningSignature"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "SigningSignature_bindingId_signerUserId_roleKey_key" ON "SigningSignature"("bindingId", "signerUserId", "roleKey");

-- AddForeignKey
ALTER TABLE "SigningDocumentVersion" ADD CONSTRAINT "SigningDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SigningDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningDocumentVersion" ADD CONSTRAINT "SigningDocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningBinding" ADD CONSTRAINT "SigningBinding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SigningDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningBinding" ADD CONSTRAINT "SigningBinding_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SigningDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningBinding" ADD CONSTRAINT "SigningBinding_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ApplicationCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningBinding" ADD CONSTRAINT "SigningBinding_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSignature" ADD CONSTRAINT "SigningSignature_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "SigningBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSignature" ADD CONSTRAINT "SigningSignature_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SigningDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSignature" ADD CONSTRAINT "SigningSignature_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: migrate the existing hiring confidentiality agreement onto the
-- generalized signing service. Source ids are reused so relations map 1:1.
-- This is the "expand" half of an expand/contract migration — the
-- Confidentiality* tables are left intact and are dropped only in a later
-- contract migration, once the repointed code is verified in staging.
-- ─────────────────────────────────────────────────────────────────────────────

-- ConfidentialityAgreement -> SigningDocument
INSERT INTO "SigningDocument"
  ("id", "createdAt", "updatedAt", "name", "slug", "kind", "gateScope", "audience")
SELECT
  a."id", a."createdAt", a."updatedAt", a."name",
  'confidentiality-' || a."id",
  'Confidentiality'::"SigningDocumentKind",
  'HiringCycle'::"SigningGateScope",
  'HiringParticipants'::"SigningAudience"
FROM "ConfidentialityAgreement" a;

-- ConfidentialityAgreementVersion -> SigningDocumentVersion (single "member" role)
INSERT INTO "SigningDocumentVersion"
  ("id", "createdAt", "versionNumber", "body", "roles", "publishedAt", "documentId", "createdById")
SELECT
  v."id", v."createdAt", v."versionNumber", v."body",
  '["member"]'::jsonb, v."createdAt", v."agreementId", v."createdById"
FROM "ConfidentialityAgreementVersion" v;

-- CycleConfidentialityAgreement -> SigningBinding (one per cycle; binding id = cycle id)
INSERT INTO "SigningBinding"
  ("id", "createdAt", "updatedAt", "documentId", "versionId", "scopeKey", "cycleId")
SELECT
  c."applicationCycleId", c."createdAt", c."updatedAt",
  v."agreementId", c."confidentialityAgreementVersionId",
  'cycle:' || c."applicationCycleId", c."applicationCycleId"
FROM "CycleConfidentialityAgreement" c
JOIN "ConfidentialityAgreementVersion" v
  ON v."id" = c."confidentialityAgreementVersionId";

-- ConfidentialityAgreementSignature -> SigningSignature (member role).
-- Only signatures whose cycle currently has a binding are carried: an unbound
-- cycle reads no_agreement in both models, so its inert signatures grant no
-- access. Signatures pinned to a now-superseded version keep their own
-- versionId, so getState still returns "unsigned" for them — identical to today.
INSERT INTO "SigningSignature"
  ("id", "signedAt", "bindingId", "versionId", "signerUserId", "roleKey", "typedName", "fieldValues")
SELECT
  s."id", s."signedAt",
  s."applicationCycleId",
  s."confidentialityAgreementVersionId",
  s."userId", 'member',
  TRIM(COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", '')),
  '{}'::jsonb
FROM "ConfidentialityAgreementSignature" s
JOIN "SigningBinding" b ON b."id" = s."applicationCycleId"
JOIN "User" u ON u."id" = s."userId";
