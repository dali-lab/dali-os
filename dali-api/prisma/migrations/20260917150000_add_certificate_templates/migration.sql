-- Operator-designed certificate templates: a full-bleed background image with
-- dynamic fields placed on top, bindable per-offering (with a lab-wide default).

CREATE TABLE "CertificateTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backgroundKey" TEXT NOT NULL,
    "backgroundContentType" TEXT NOT NULL,
    "bgWidth" INTEGER NOT NULL,
    "bgHeight" INTEGER NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EducationCertificateBinding" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EducationCertificateBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EducationCertificateBinding_offeringId_key" ON "EducationCertificateBinding"("offeringId");

ALTER TABLE "EducationCertificate" ADD COLUMN "templateId" TEXT;
