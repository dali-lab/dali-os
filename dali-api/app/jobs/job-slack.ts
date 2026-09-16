// Shared gate for unattended (job-driven) Slack channel posts.
//
// Prod-only for the same reason as notify()'s Slack-DM gate: staging restores a
// prod snapshot on every deploy, so real project channel ids live there.
// NOTIFY_SLACK_DM_OVERRIDE=1 covers testing all unattended outbound Slack,
// channel posts included.

import { getAppEnv } from "~/lib/app-env";

export function jobChannelPostAllowed(): boolean {
  return getAppEnv() === "prod" || process.env.NOTIFY_SLACK_DM_OVERRIDE === "1";
}
