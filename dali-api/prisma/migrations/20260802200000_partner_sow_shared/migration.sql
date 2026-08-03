-- SOW feedback loop: Core can draft the Statement of Work privately and then
-- explicitly share it with the applicant for feedback. Null = not yet shared.
ALTER TABLE "PartnerApplication" ADD COLUMN "sowSharedAt" TIMESTAMP(3);
