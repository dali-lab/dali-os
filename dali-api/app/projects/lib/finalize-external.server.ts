import { getAppEnv } from "~/lib/app-env";

// The staffing-finalize Slack / GitHub / Google steps call real external
// workspaces. There is no separate staging tenant for any of them — the tokens
// on non-prod apps point at the same production Slack workspace, GitHub org, and
// Google domain — so a finalize run on staging would post to real channels,
// mutate real teams, and add real group members. They therefore run in prod
// only; set FINALIZE_EXTERNAL_OVERRIDE=1 to exercise them from a non-prod env on
// purpose. Mirrors the NOTIFY_SLACK_DM_OVERRIDE gate for Slack DMs.
//
// The DB-only "assignments" step is unaffected — it has no external side effect.
export function externalFinalizeAllowed(): boolean {
  return getAppEnv() === "prod" || process.env.FINALIZE_EXTERNAL_OVERRIDE === "1";
}

export const EXTERNAL_FINALIZE_SKIP_MESSAGE =
  "Skipped on non-prod (set FINALIZE_EXTERNAL_OVERRIDE=1 to test).";
