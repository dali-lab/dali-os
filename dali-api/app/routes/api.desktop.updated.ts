// POST /api/desktop/updated — the desktop shell reports a completed self-update
// so it lands in the audit trail. The update download/install runs client↔S3
// (see desktop/src-tauri/src/updater.rs), off-server, so this authenticated ping
// is the only server-side record of who updated when. Body: { from, to } version
// strings; a missing/garbled body still records the event with "unknown".

import type { Route } from "./+types/api.desktop.updated";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  let from: string | null = null;
  let to: string | null = null;
  try {
    const json = (await request.json()) as { from?: unknown; to?: unknown };
    if (typeof json.from === "string") from = json.from.slice(0, 32);
    if (typeof json.to === "string") to = json.to.slice(0, 32);
  } catch {
    // Tolerate a missing/garbled body — still record that an update happened.
  }

  await logAuditEvent({
    action: "desktop.update",
    userId: auth.user.sub,
    metadata: { from: from ?? "unknown", to: to ?? "unknown" },
    request,
  });

  return withCors(request, Response.json({ ok: true }));
}
