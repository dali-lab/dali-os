-- Live deployment / hosted URL for the project (e.g. a Fly/Vercel app).
-- Single link, shown on the project detail page next to the repos. Nullable,
-- additive — no backfill, no data loss.
ALTER TABLE "Project" ADD COLUMN "deploymentUrl" TEXT;
