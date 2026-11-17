import { getAppEnv } from "~/lib/app-env";
import { getEnv } from "~/lib/env.server";

export function slackSendAllowed(): boolean {
  return getAppEnv() === "prod" || getEnv().NOTIFY_SLACK_DM_OVERRIDE === "1";
}
