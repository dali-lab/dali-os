-- Add profile fields to DALIMember (new columns, no data to migrate)
ALTER TABLE "DALIMember" ADD COLUMN "profilePictureKey" TEXT;
ALTER TABLE "DALIMember" ADD COLUMN "graduationYear" INTEGER;
ALTER TABLE "DALIMember" ADD COLUMN "major" TEXT;
ALTER TABLE "DALIMember" ADD COLUMN "githubUrl" TEXT;
ALTER TABLE "DALIMember" ADD COLUMN "linkedinUrl" TEXT;
ALTER TABLE "DALIMember" ADD COLUMN "portfolioUrl" TEXT;

-- Add Google token columns to DALIMember
ALTER TABLE "DALIMember" ADD COLUMN "googleAccessToken" TEXT;
ALTER TABLE "DALIMember" ADD COLUMN "googleRefreshToken" TEXT;
ALTER TABLE "DALIMember" ADD COLUMN "googleTokenExpiresAt" TIMESTAMP(3);

-- Copy existing token data from User to DALIMember where linked
UPDATE "DALIMember" m
SET "googleAccessToken"    = u."googleAccessToken",
    "googleRefreshToken"   = u."googleRefreshToken",
    "googleTokenExpiresAt" = u."googleTokenExpiresAt"
FROM "User" u
WHERE m."userId" = u."id"
  AND (u."googleAccessToken" IS NOT NULL
    OR u."googleRefreshToken" IS NOT NULL
    OR u."googleTokenExpiresAt" IS NOT NULL);

-- Drop token columns from User
ALTER TABLE "User" DROP COLUMN "googleAccessToken";
ALTER TABLE "User" DROP COLUMN "googleRefreshToken";
ALTER TABLE "User" DROP COLUMN "googleTokenExpiresAt";
