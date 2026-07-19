// GET /api/desktop/version — unauthenticated, no DB. Advertises the minimum and
// latest supported desktop shell versions so the Tauri app can force a security
// update (appVersion < minVersion) or nudge a soft update (appVersion <
// latestVersion). Env-driven with safe fallbacks. See TAURI_DESKTOP_PLAN.md.

import type { Route } from "./+types/api.desktop.version";

export async function loader(_: Route.LoaderArgs) {
  const body = {
    minVersion: process.env.DESKTOP_MIN_VERSION ?? "0.0.0",
    latestVersion: process.env.DESKTOP_LATEST_VERSION ?? "0.0.0",
    downloadUrl: process.env.DESKTOP_DOWNLOAD_URL ?? null,
    notesUrl: process.env.DESKTOP_NOTES_URL ?? null,
  };
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
