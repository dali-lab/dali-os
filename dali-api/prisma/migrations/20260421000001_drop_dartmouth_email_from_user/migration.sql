-- Drop dartmouthEmail from User (replaced by the BetterAuth email field)
ALTER TABLE "User" DROP COLUMN IF EXISTS "dartmouthEmail";
