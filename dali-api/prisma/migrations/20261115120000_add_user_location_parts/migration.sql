-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentLocationCity" TEXT,
ADD COLUMN     "currentLocationCountry" TEXT,
ADD COLUMN     "currentLocationGeonameId" INTEGER,
ADD COLUMN     "currentLocationRegion" TEXT;
