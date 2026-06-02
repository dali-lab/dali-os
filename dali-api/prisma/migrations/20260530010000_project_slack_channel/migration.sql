-- Per-project Slack channel id (e.g. "C0123ABC"). The channel NAME is derived
-- from the project name; the staffing finalize automation get-or-creates that
-- channel, backfills this id, then invites confirmed members + posts the team
-- announcement. Null = the channel step hasn't run yet. Nullable.
ALTER TABLE "Project" ADD COLUMN "slackChannelId" TEXT;
