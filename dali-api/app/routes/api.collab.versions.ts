import type { Route } from "./+types/api.collab.versions";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { authorizeCollabDoc, hydrateAuthors } from "~/lib/collabAuth";

const PREVIEW_CHARS = 200;

// GET /api/collab/versions?name=review:abc123:feedback
// Returns all snapshots for the given doc, newest first, with truncated
// previews and hydrated author display names.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  if (!name) {
    return withAuth(auth, Response.json({ error: "name query param required" }, { status: 400 }));
  }

  const allowed = await authorizeCollabDoc(auth.user.sub, name);
  if (!allowed) return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));

  const versions = await prisma.collabDocumentVersion.findMany({
    where: { name },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, plainText: true, authorIds: true },
  });

  // Batch-hydrate all unique author IDs across every version.
  const allAuthorIds = new Set<string>();
  for (const v of versions) for (const id of v.authorIds) allAuthorIds.add(id);
  const authorList = await hydrateAuthors(Array.from(allAuthorIds));
  const authorsById = new Map(authorList.map((a) => [a.id, a]));

  return withAuth(auth, Response.json(
      versions.map((v) => ({
        id: v.id,
        createdAt: v.createdAt,
        plainTextPreview:
          v.plainText.length > PREVIEW_CHARS
            ? `${v.plainText.slice(0, PREVIEW_CHARS).trimEnd()}\u2026`
            : v.plainText,
        authors: v.authorIds
          .map((id) => authorsById.get(id))
          .filter(Boolean),
      })),
    ));
}
