import type { Route } from "./+types/api.collab.versions.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { authorizeCollabDoc, hydrateAuthors } from "~/lib/collabAuth";
import { getCollabServer } from "~/collab/server";
import { restoreVersion } from "~/collab/persistence";

// GET /api/collab/versions/{id}
// Returns the full plain-text content of a single snapshot for preview.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      createdAt: true,
      plainText: true,
      authorIds: true,
    },
  });
  if (!version) return Response.json({ error: "Not found" }, { status: 404 });

  const allowed = await authorizeCollabDoc(auth.user.sub, version.name);
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

  return Response.json({
    id: version.id,
    createdAt: version.createdAt,
    plainText: version.plainText,
    authors: await hydrateAuthors(version.authorIds),
  });
}

// POST /api/collab/versions/{id}  body: { intent: "restore" }
// Replaces the live doc content with this snapshot. The actual Y.js mutation
// runs server-side via Hocuspocus's direct connection — clients see the
// update through the existing websocket sync, no reload needed.
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { intent?: string };
  if (body.intent !== "restore") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }

  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!version) return Response.json({ error: "Not found" }, { status: 404 });

  const allowed = await authorizeCollabDoc(auth.user.sub, version.name);
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

  const server = getCollabServer();
  if (!server) {
    return Response.json({ error: "Collab server not running" }, { status: 503 });
  }

  await restoreVersion(server, version.name, version.id);
  return Response.json({ ok: true });
}
