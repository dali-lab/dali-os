import type { Route } from "./+types/api.move-destinations";
import { prisma } from "~/lib/db";
import { requireMemberSession } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { withCors, handlePreflight } from "~/lib/cors";

// GET /api/move-destinations — where the current member may move a document:
// the Lab-wide shelf plus every project they can edit, each with its folders.
// Eligibility mirrors the Documents hub project query so the picker only offers
// destinations the move endpoint would actually accept.
//
// ACCESS: every folder goes through getPageAccess and only the ones the caller
// can EDIT are returned. The Lab workspace holds the Core-scoped folders, so an
// unfiltered list handed every lab member the name of every Core folder, and
// offered destinations the move endpoint now refuses anyway. Edit, not view, is
// the right bar: this list exists to answer "where may I put this".

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const userId = gate.auth.user.sub;
  const core = await isCore(userId, request);

  const projects = await prisma.project.findMany({
    where: core ? {} : { assignments: { some: { userId } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, iconEmoji: true },
  });
  const projectIds = projects.map((p) => p.id);

  // All folders (every depth), so the picker can drill into nested folders. Each
  // carries its parentPageId — null at a workspace's top level — for tree build.
  const folders = await prisma.page.findMany({
    where: {
      kind: "Folder",
      archivedAt: null,
      OR: [
        { workspaceType: "Lab", workspaceId: null },
        ...(projectIds.length
          ? [{ workspaceType: "Project" as const, workspaceId: { in: projectIds } }]
          : []),
      ],
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      parentPageId: true,
      workspaceType: true,
      workspaceId: true,
      // getPageAccess reads these off the row rather than re-fetching it.
      archivedAt: true,
      createdById: true,
      partnerVisible: true,
      profileVisible: true,
      labListing: true,
      linkAccess: true,
      linkPermission: true,
      scopeKind: true,
      scopeGroupId: true,
      scopePermission: true,
    },
  });

  const access = await getPageAccessBulk(userId, folders, request);
  const visible = folders.filter((f) => access.get(f.id)?.canEdit);

  // A folder whose own parent was filtered out would point at an id the picker
  // doesn't hold and never render, so it moves to that drive's top level.
  const visibleIds = new Set(visible.map((f) => f.id));

  // What each folder holds, so a picker row can say more than its name (two
  // folders can share a title). Two grouped counts over the visible folder ids
  // rather than a per-row query; forms are left out because their placement is
  // organisation-only and gated separately.
  const visibleFolderIds = [...visibleIds];
  const [pageCounts, fileCounts] = visibleFolderIds.length
    ? await Promise.all([
        prisma.page.groupBy({
          by: ["parentPageId"],
          where: { parentPageId: { in: visibleFolderIds }, archivedAt: null },
          _count: { _all: true },
        }),
        prisma.projectFile.groupBy({
          by: ["folderPageId"],
          where: { folderPageId: { in: visibleFolderIds }, archivedAt: null },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const childCount = new Map<string, number>();
  for (const row of pageCounts) {
    if (row.parentPageId) childCount.set(row.parentPageId, row._count._all);
  }
  for (const row of fileCounts) {
    if (row.folderPageId) {
      childCount.set(row.folderPageId, (childCount.get(row.folderPageId) ?? 0) + row._count._all);
    }
  }

  const foldersByWs = new Map<
    string,
    { id: string; title: string; parentId: string | null; itemCount: number }[]
  >();
  for (const f of visible) {
    const key = f.workspaceType === "Lab" ? "lab" : f.workspaceId!;
    const arr = foldersByWs.get(key) ?? [];
    arr.push({
      id: f.id,
      title: f.title,
      parentId: f.parentPageId && visibleIds.has(f.parentPageId) ? f.parentPageId : null,
      itemCount: childCount.get(f.id) ?? 0,
    });
    foldersByWs.set(key, arr);
  }

  const destinations = [
    { type: "Lab" as const, id: null, label: "Lab-wide", iconEmoji: null, folders: foldersByWs.get("lab") ?? [] },
    ...projects.map((p) => ({
      type: "Project" as const,
      id: p.id,
      label: p.name,
      iconEmoji: p.iconEmoji,
      folders: foldersByWs.get(p.id) ?? [],
    })),
  ];

  return withCors(request, Response.json({ destinations }));
}
