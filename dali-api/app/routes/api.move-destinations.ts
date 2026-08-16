import type { Route } from "./+types/api.move-destinations";
import { prisma } from "~/lib/db";
import { requireMemberSession } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// GET /api/move-destinations — where the current member may move a document:
// the Lab-wide shelf plus every project they can edit, each with its top-level
// folders. Eligibility mirrors the Documents hub project query so the picker
// only offers destinations the move endpoint would actually accept.

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const userId = gate.auth.user.sub;
  const core = await isCore(userId);

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
    select: { id: true, title: true, parentPageId: true, workspaceType: true, workspaceId: true },
  });

  const foldersByWs = new Map<string, { id: string; title: string; parentId: string | null }[]>();
  for (const f of folders) {
    const key = f.workspaceType === "Lab" ? "lab" : f.workspaceId!;
    const arr = foldersByWs.get(key) ?? [];
    arr.push({ id: f.id, title: f.title, parentId: f.parentPageId });
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
