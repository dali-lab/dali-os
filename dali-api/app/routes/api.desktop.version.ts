// GET /api/desktop/version — unauthenticated, no DB. Advertises the minimum and
// latest supported desktop shell versions so the Tauri app can force a security
// update (appVersion < minVersion) or nudge a soft update (appVersion <
// latestVersion). Env-driven with safe fallbacks. See specs/archive/TAURI_DESKTOP_PLAN.md.

import type { Route } from "./+types/api.desktop.version";
import { getEnv } from "~/lib/env.server";

export async function loader(_: Route.LoaderArgs) {
  const body = {
    minVersion: getEnv().DESKTOP_MIN_VERSION ?? "0.0.0",
    latestVersion: getEnv().DESKTOP_LATEST_VERSION ?? "0.0.0",
    downloadUrl: getEnv().DESKTOP_DOWNLOAD_URL ?? null,
    notesUrl: getEnv().DESKTOP_NOTES_URL ?? null,
  };
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
