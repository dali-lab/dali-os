import type { Route } from "./+types/api.mentions.pages";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";

// GET /api/mentions/pages?q=...
// Backs the @-mention "Pages" group in the suggestion menu. Returns live
// (non-archived) pages matching the query title, scoped to pages the viewer
// may access. Security model mirrors searchDocuments in lib/search.server.ts:
// any lab member may open any live page by URL, so title search is safe for
// all members. Capped small — the suggestion menu isn't a full search UI.

const LIMIT = 8;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isLabMember(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  const rows = await prisma.page.findMany({
    where: {
      archivedAt: null,
      ...(q
        ? { title: { contains: q, mode: "insensitive" } }
        : {}),
    },
    select: { id: true, title: true, iconEmoji: true },
    orderBy: { title: "asc" },
    take: LIMIT,
  });

  const pages = rows.map((p) => ({
    id: p.id,
    title: p.title,
    iconEmoji: p.iconEmoji,
  }));

  return Response.json({ pages });
}
