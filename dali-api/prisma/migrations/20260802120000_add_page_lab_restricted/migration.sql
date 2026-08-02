-- Lab-workspace document access. Default false so every existing lab document
-- stays readable/editable by the whole lab, which is the behaviour the hub has
-- had since it shipped. Sharing itself reuses the existing PageShare table.
ALTER TABLE "Page" ADD COLUMN "labRestricted" BOOLEAN NOT NULL DEFAULT false;
