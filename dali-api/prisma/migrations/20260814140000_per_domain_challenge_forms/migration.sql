-- Per-domain hiring challenges can now be Drive Forms (additive; the legacy
-- ChallengeVersion path stays intact). Adds a Cycle↔Form↔domain join and a
-- FormVersion pin on DomainApplication. No data conversion — existing
-- challenges keep working; new ones can be Forms.

-- CycleDomainForm: a Form linked to a (cycle, domain) as one of that domain's
-- challenges. A domain may have several — the applicant picks one.
CREATE TABLE "CycleDomainForm" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationCycleId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,

    CONSTRAINT "CycleDomainForm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CycleDomainForm_applicationCycleId_domainId_formId_key"
    ON "CycleDomainForm"("applicationCycleId", "domainId", "formId");
CREATE INDEX "CycleDomainForm_applicationCycleId_idx" ON "CycleDomainForm"("applicationCycleId");
CREATE INDEX "CycleDomainForm_domainId_idx" ON "CycleDomainForm"("domainId");
CREATE INDEX "CycleDomainForm_formId_idx" ON "CycleDomainForm"("formId");

ALTER TABLE "CycleDomainForm" ADD CONSTRAINT "CycleDomainForm_applicationCycleId_fkey"
    FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CycleDomainForm" ADD CONSTRAINT "CycleDomainForm_domainId_fkey"
    FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CycleDomainForm" ADD CONSTRAINT "CycleDomainForm_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pin: the FormVersion of the per-domain challenge Form the applicant answered.
ALTER TABLE "DomainApplication" ADD COLUMN "challengeFormVersionId" TEXT;
CREATE INDEX "DomainApplication_challengeFormVersionId_idx" ON "DomainApplication"("challengeFormVersionId");
ALTER TABLE "DomainApplication" ADD CONSTRAINT "DomainApplication_challengeFormVersionId_fkey"
    FOREIGN KEY ("challengeFormVersionId") REFERENCES "FormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
