import type { Route } from "./+types/api.collab.versions.$id";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { authorizeCollabDoc, hydrateAuthors } from "~/lib/collabAuth";
import { getCollabServer } from "~/collab/server";
import { restoreVersion } from "~/collab/persistence";
import { parseJson } from "~/lib/validate";
import { stateToBlocks } from "~/collab/read";
import { blocksToHtml } from "~/collab/blocknote-server";

const RestoreSchema = z.object({
  intent: z.literal("restore"),
});

const NameSchema = z.object({
  intent: z.literal("name"),
  label: z.string().max(200),
});

const ActionSchema = z.union([RestoreSchema, NameSchema]);

// GET /api/collab/versions/{id}
// Returns the full content of a single snapshot for preview: plain text
// fallback plus `html` — a rich HTML rendering decoded from the Y.Doc state.
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
      label: true,
      state: true,
    },
  });
  if (!version) return Response.json({ error: "Not found" }, { status: 404 });

  const { allowed } = await authorizeCollabDoc(auth.user.sub, version.name);
  if (!allowed) return forbidden(request);

  // Decode the stored Y.Doc snapshot to blocks and render as HTML. stateToBlocks
  // constructs a fresh throwaway Y.Doc (never touches a live doc) and applies
  // the binary update — safe per the persistence.ts clone rule.
  let html = "";
  try {
    const { blocks } = stateToBlocks(new Uint8Array(version.state));
    html = blocks.length > 0 ? await blocksToHtml(blocks) : "";
  } catch {
    // Fall through — client falls back to plainText.
    html = "";
  }

  return Response.json({
    id: version.id,
    createdAt: version.createdAt,
    label: version.label ?? null,
    plainText: version.plainText,
    html,
    authors: await hydrateAuthors(version.authorIds),
  });
}

// POST /api/collab/versions/{id}
//   body: { intent: "restore" }           — replace live doc with this snapshot
//   body: { intent: "name", label: "…" }  — set (or clear) the version's label;
//                                           empty string clears to null (unpinned)
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = await parseJson(request, ActionSchema);
  if (body instanceof Response) return body;

  const version = await prisma.collabDocumentVersion.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!version) return Response.json({ error: "Not found" }, { status: 404 });

  const { allowed } = await authorizeCollabDoc(auth.user.sub, version.name);
  if (!allowed) return forbidden(request);

  if (body.intent === "name") {
    // Empty string clears the label (unpin); non-empty string sets it.
    const label = body.label.trim() || null;
    await prisma.collabDocumentVersion.update({
      where: { id: params.id },
      data: { label },
    });
    return Response.json({ ok: true, label });
  }

  // intent === "restore"
  const server = getCollabServer();
  if (!server) {
    return Response.json({ error: "Collab server not running" }, { status: 503 });
  }

  await restoreVersion(server, version.name, version.id);
  return Response.json({ ok: true });
}
