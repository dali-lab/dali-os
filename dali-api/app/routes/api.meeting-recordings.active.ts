// GET /api/meeting-recordings/active — the requesting user's own recording
// that is still on the go (not yet inserted into its note), for the
// app-level recording pill. Owner-only; never returns transcript text.

import type { Route } from "./+types/api.meeting-recordings.active";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { documentTitle } from "~/lib/meeting-recording.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("ai-meeting-notes", auth.user.sub, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  const rec = await prisma.meetingRecording.findFirst({
    where: { userId: auth.user.sub, status: { in: ["Pending", "Recording", "Stopped"] }, insertedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, documentName: true, status: true, sessionStartedAt: true },
  });
  if (!rec) return Response.json({ recording: null });

  const [entity, id, part] = rec.documentName.split(":");
  let href: string | null = null;
  let title = "Recording";
  if (entity === "doc" && id) {
    href = `/documents/${id}`;
    title = ((await documentTitle(rec.documentName)) ?? "") || "Untitled";
  } else if (entity === "interview" && id && part === "notes") {
    href = `/hiring/interviews/${id}`;
    // Not the applicant's name: the pill shows on every page, screen shares included.
    title = "Interview";
  }
  const sessionSeconds =
    rec.status === "Recording" && rec.sessionStartedAt
      ? Math.max(0, (Date.now() - rec.sessionStartedAt.getTime()) / 1000)
      : null;

  return Response.json({
    recording: {
      id: rec.id,
      documentName: rec.documentName,
      status: rec.status,
      title,
      href,
      sessionSeconds,
    },
  });
}
