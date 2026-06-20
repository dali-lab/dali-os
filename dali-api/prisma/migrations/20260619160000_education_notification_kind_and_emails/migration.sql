-- Education enum value on NotificationKind so the bell can icon/route
-- education events distinctly from generic ones.
ALTER TYPE "NotificationKind" ADD VALUE 'Education';

-- Per-offering binding of an EmailTemplateVersion to an EduApplicationStatus.
-- No row = inline fallback strings used.
CREATE TABLE "OfferingDecisionEmail" (
    "offeringId" TEXT NOT NULL,
    "status" "EduApplicationStatus" NOT NULL,
    "emailTemplateVersionId" TEXT NOT NULL,

    CONSTRAINT "OfferingDecisionEmail_pkey" PRIMARY KEY ("offeringId", "status")
);

ALTER TABLE "OfferingDecisionEmail"
  ADD CONSTRAINT "OfferingDecisionEmail_offeringId_fkey"
  FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingDecisionEmail"
  ADD CONSTRAINT "OfferingDecisionEmail_emailTemplateVersionId_fkey"
  FOREIGN KEY ("emailTemplateVersionId") REFERENCES "EmailTemplateVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optional explicit ordering for Waitlisted EducationApplication rows.
ALTER TABLE "EducationApplication"
  ADD COLUMN "waitlistRank" INTEGER;

-- Calendar push fields on EducationSession.
ALTER TABLE "EducationSession"
  ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "calendarEventId" TEXT;
