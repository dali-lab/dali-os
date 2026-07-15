-- CreateEnum
CREATE TYPE "FormAudience" AS ENUM ('Members', 'SignedIn', 'Groups', 'Public');

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "audience" "FormAudience" NOT NULL DEFAULT 'Members',
ADD COLUMN     "audienceGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "submitterIp" TEXT;
