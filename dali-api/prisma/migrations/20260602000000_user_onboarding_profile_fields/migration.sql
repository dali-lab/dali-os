-- Additional profile fields collected on the New Member Profile (onboarding)
-- form. All nullable, so no backfill is needed for existing users.
ALTER TABLE "User" ADD COLUMN "nameOnFile" TEXT;
ALTER TABLE "User" ADD COLUMN "collegeId" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT;
ALTER TABLE "User" ADD COLUMN "birthday" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "ethnicity" TEXT;
ALTER TABLE "User" ADD COLUMN "dietaryRestrictions" TEXT;
