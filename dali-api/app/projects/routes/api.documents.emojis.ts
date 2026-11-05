import type { Route } from "./+types/api.documents.emojis";
import { prisma } from "~/lib/db.server";
import { requireMemberSession } from "~/lib/auth";
import { MAX_TABS } from "~/lib/desktop-tabs";
import { getPageAccessBulk, PAGE_ACCESS_SELECT } from "~/lib/pageAccess.server";

// GET /api/documents/emojis?ids=a,b — { emojis: { [id]: emoji | null } }, for
// desktop tabs that haven't shown their page yet. A page the caller can't view
// is left out.
export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const param = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(param.split(",").filter(Boolean))].slice(0, MAX_TABS);
  if (ids.length === 0) return Response.json({ emojis: {} });

  const pages = await prisma.page.findMany({
    where: { id: { in: ids } },
    select: { ...PAGE_ACCESS_SELECT, iconEmoji: true },
  });
  const access = await getPageAccessBulk(gate.auth.user.sub, pages, request);
  const emojis = Object.fromEntries(
    pages.filter((p) => access.get(p.id)?.canView).map((p) => [p.id, p.iconEmoji]),
  );
  return Response.json({ emojis });
}
