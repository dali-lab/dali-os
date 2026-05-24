import type { Route } from "./+types/api.epics.$id.description-doc";
import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/epics/:id/description-doc
//
// Lazily provision the collab-doc room name for an Epic's rich description.
// Returns `{ descriptionDocId }`. Idempotent: if the column is already set,
// the stored value is returned untouched. If null, a new opaque id is
// generated, written, and returned.
//
// Called by the epic detail modal when it first opens so the
// CollaborativeEditor has a stable room name to bind to. The id is opaque —
// not a Page row, no migration to a richer model. authorizeCollabDoc has an
// `epic` branch that looks the column up here.
//
// Same edit gate as the rest of the epic API (isCore === Admin || Core).

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const epicId = params.id!;
  const epic = await prisma.epic.findUnique({
    where: { id: epicId },
    select: { descriptionDocId: true },
  });
  if (!epic) {
    return withCors(request, Response.json({ error: "Epic not found" }, { status: 404 }));
  }

  if (epic.descriptionDocId) {
    return withCors(
      request,
      Response.json({ descriptionDocId: epic.descriptionDocId }),
    );
  }

  // Use crypto.randomUUID rather than Prisma's @default(cuid()) since this
  // column is a plain string with no default. The room name is opaque to the
  // editor; collisions are negligible at UUID width.
  const descriptionDocId = randomUUID();
  await prisma.epic.update({
    where: { id: epicId },
    data: { descriptionDocId },
  });
  return withCors(request, Response.json({ descriptionDocId }));
}
