-- Tighten OAuthSession.provider and OAuthSession.accountType from free-form
-- text to Prisma enums. All current values ("google", "cas" for provider;
-- "member", "dartmouth", "partner", or NULL for accountType) match the new
-- enum labels, so the USING cast is a 1:1 relabel — no data conversion.

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('google', 'cas');

-- CreateEnum
CREATE TYPE "OAuthAccountType" AS ENUM ('member', 'dartmouth', 'partner');

-- AlterTable
ALTER TABLE "OAuthSession"
  ALTER COLUMN "provider" TYPE "OAuthProvider"
    USING ("provider"::text::"OAuthProvider"),
  ALTER COLUMN "accountType" TYPE "OAuthAccountType"
    USING ("accountType"::text::"OAuthAccountType");
