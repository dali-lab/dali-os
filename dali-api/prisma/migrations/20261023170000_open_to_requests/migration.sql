-- CreateEnum
CREATE TYPE "CoffeeChatKind" AS ENUM ('CoffeeChat', 'ResumeReview');

-- AlterTable
ALTER TABLE "CoffeeChatInvite" ADD COLUMN     "kind" "CoffeeChatKind" NOT NULL DEFAULT 'CoffeeChat';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "openToCoffeeChats" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "openToResumeReviews" BOOLEAN NOT NULL DEFAULT false;
