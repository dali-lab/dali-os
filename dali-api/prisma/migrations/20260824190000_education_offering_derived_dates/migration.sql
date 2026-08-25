-- EducationOffering.startsAt and .endsAt are now derived from sessions
-- (recomputed on every session add/update/delete) rather than manually
-- entered at creation. Making them nullable so a newly-created offering
-- with no sessions yet can omit them.

ALTER TABLE "EducationOffering" ALTER COLUMN "startsAt" DROP NOT NULL;
ALTER TABLE "EducationOffering" ALTER COLUMN "endsAt" DROP NOT NULL;
