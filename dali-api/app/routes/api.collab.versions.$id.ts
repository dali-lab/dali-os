import type { Route } from "./+types/api.collab.versions.$id";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { authorizeCollabDoc, hydrateAuthors } from "~/lib/collabAuth";
import { getCollabServer } from "~/collab/server";
import { restoreVersion } from "~/collab/persistence";
import { parseJson } from "~/lib/validate";

const RestoreSchema = z.object({
  intent: z.literal("restore"),
});

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

  const { allowed } = await authorizeCollabDoc(auth.user.sub, version.name);
  if (!allowed) return forbidden(request);

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

  const body = await parseJson(request, RestoreSchema);
  if (body instanceof Response) return body;

  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!version) return Response.json({ error: "Not found" }, { status: 404 });

  const { allowed } = await authorizeCollabDoc(auth.user.sub, version.name);
  if (!allowed) return forbidden(request);

  const server = getCollabServer();
  if (!server) {
    return Response.json({ error: "Collab server not running" }, { status: 503 });
  }

  await restoreVersion(server, version.name, version.id);
  return Response.json({ ok: true });
}
