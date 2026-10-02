-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN "frontPageRank" INTEGER;

-- Featured posts stay pinned.
UPDATE "BlogPost" SET "frontPageRank" = 0 WHERE "featured";

-- AlterTable
ALTER TABLE "BlogPost" DROP COLUMN "featured";
