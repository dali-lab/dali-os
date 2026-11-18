-- AlterTable
ALTER TABLE "User" ADD COLUMN "preferredEmail" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "majors" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: each existing major becomes a one-item list.
UPDATE "User" SET "majors" = ARRAY[btrim("major")] WHERE "major" IS NOT NULL AND btrim("major") <> '';

-- AlterTable: minors was free text; split it on commas and semicolons.
ALTER TABLE "User" ALTER COLUMN "minors" SET DATA TYPE TEXT[] USING (
  CASE
    WHEN "minors" IS NULL OR btrim("minors") = '' THEN ARRAY[]::TEXT[]
    ELSE array_remove(string_to_array(regexp_replace(btrim("minors"), '\s*[,;]\s*', ',', 'g'), ','), '')
  END
);
ALTER TABLE "User" ALTER COLUMN "minors" SET DEFAULT ARRAY[]::TEXT[];
