-- Human-editable Slack channel name, shared between the project details page and
-- the staffing Finalize modal. slackChannelId (the live channel id) is backfilled
-- when the channel is get-or-created on finalize / modal Save.
ALTER TABLE "Project" ADD COLUMN "slackChannelName" TEXT;
