import { getAppEnv } from "~/lib/app-env";

export function slackSendAllowed(): boolean {
  return getAppEnv() === "prod" || process.env.NOTIFY_SLACK_DM_OVERRIDE === "1";
}
