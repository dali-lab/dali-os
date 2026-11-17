-- AlterTable
ALTER TABLE "User" ADD COLUMN "minors" TEXT;
ALTER TABLE "User" ADD COLUMN "funFact" TEXT;
ALTER TABLE "User" ADD COLUMN "openToPortfolioReviews" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PixelAvatar" ADD COLUMN "confirmedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
