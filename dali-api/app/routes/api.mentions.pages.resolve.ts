import type { Route } from "./+types/api.mentions.pages.resolve";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";

// GET /api/mentions/pages/resolve?ids=a,b,c
// Resolves a set of pageIds → current titles for live @page-mention chips.
// Returns only pages the viewer may access (same permission model as
// api.mentions.pages: any lab member may read any live, non-archived page).
// Archived/deleted pages and pages the caller cannot access are OMITTED from
// the response — callers fall back to the stored label snapshot.
// Capped at 200 ids per request as a defensive measure.

const MAX_IDS = 200;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isLabMember(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = new URL(request.url).searchParams.get("ids")?.trim() ?? "";
  if (!raw) return Response.json({ titles: {} });

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (ids.length === 0) return Response.json({ titles: {} });

  // Same permission model as api.mentions.pages: any lab member may see any
  // live (non-archived) page. Archived or deleted pages are silently omitted.
  const rows = await prisma.page.findMany({
    where: {
      id: { in: ids },
      archivedAt: null,
    },
    select: { id: true, title: true },
  });

  const titles: Record<string, string> = {};
  for (const row of rows) {
    titles[row.id] = row.title;
  }

  return Response.json({ titles });
}
