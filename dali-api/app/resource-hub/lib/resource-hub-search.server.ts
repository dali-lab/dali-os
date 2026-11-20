import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { ledDomainIds, resourceHubViewer } from "~/resource-hub/lib/resource-hub.server";
import { buildUrl, rankResults, type SearchResult } from "~/lib/search";

type Like = { contains: string; mode: "insensitive" };
type Budget = { rawTake: number; cap: number; ordered: boolean };
type Opts = { userId: string; request?: Request };

// Published hubs for everyone; drafts only for Core, their creator and their domain's leads.
async function visibleHubWhere(opts: Opts): Promise<Prisma.ResourceHubPageWhereInput | null> {
  const viewer = await resourceHubViewer(opts.userId, opts.request);
  if (!viewer) return null;
  if (viewer.core) return {};
  const led = await ledDomainIds(opts.userId);
  return {
    OR: [
      { publishedAt: { not: null } },
      { createdById: opts.userId },
      ...(led.length ? [{ domainId: { in: led } }] : []),
    ],
  };
}

export async function searchResourceHubs(opts: Opts, q: string, like: Like, b: Budget): Promise<SearchResult[]> {
  const visible = await visibleHubWhere(opts);
  if (!visible) return [];
  const rows = await prisma.resourceHubPage.findMany({
    where: { AND: [visible, { OR: [{ title: like }, { domain: { displayName: like } }] }] },
    select: { id: true, title: true, publishedAt: true, domain: { select: { displayName: true } } },
    take: b.rawTake,
    orderBy: b.ordered ? { id: "asc" } : undefined,
  });
  return rankResults(
    rows.map((r) => ({
      result: {
        type: "resourceHub" as const,
        id: r.id,
        title: r.title,
        subtitle: [r.domain?.displayName, r.publishedAt ? null : "Draft"].filter(Boolean).join(" · ") || "Resource Hub",
        url: buildUrl.resourceHub(r.id),
      },
      text: [r.title, r.domain?.displayName ?? ""],
    })),
    q,
    b.cap,
  );
}
