import type { Route } from "./+types/api.drive.destinations";
import { prisma } from "~/lib/db";
import { requireMemberSession } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { PAGE_ACCESS_SELECT, getPageAccessBulk } from "~/lib/pageAccess.server";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import { moveConstraintFor } from "~/lib/move-constraint.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { applyMoveConstraint, buildPickerRows, keepWritable, searchRows } from "~/components/drive/picker-rows";

// GET /api/drive/destinations[?q=] — every place the viewer may put something,
// as the folder picker's rows: drives (My Drive, Lab, Core, Hiring, Mentorship,
// Projects, Education) and their folders, each folder with its folderType and
// item count. The same loader and row builder as the Drive hub, so a picker
// offers the same destinations wherever it is opened.
//
// ACCESS: the loader already drops what the viewer cannot view. This narrows to
// what they can EDIT, the bar `/api/move-destinations` uses: a folder needs
// `canEdit`, a process-root drive needs an editable root, and My Drive is
// always the owner's. Projects are Core's or the viewer's own; Education
// offerings are Core's or ones they instruct.
//
// `moving=id,id` names the pages about to be moved; drives and folders the move
// rules would refuse (out of a typed root, a system folder out of its
// workspace) are left out.

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const gate = await requireMemberSession(request);
  if (!gate.ok) return gate.response;
  const userId = gate.auth.user.sub;
  const core = await isCore(userId, request);

  const [projects, offerings] = await Promise.all([
    prisma.project.findMany({
      where: core ? {} : { assignments: { some: { userId } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, iconEmoji: true },
    }),
    prisma.educationOffering.findMany({
      where: core ? {} : { instructors: { some: { userId } } },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  const scopes = await loadDriveScopes({
    auth: gate.auth,
    projectWorkspaces: projects.map((p) => ({
      key: p.id,
      label: p.name,
      kind: "project" as const,
      projectIconEmoji: p.iconEmoji,
    })),
    educationWorkspaces: offerings.map((o) => ({ key: o.id, label: o.title, kind: "education" as const })),
    canViewForms: false,
    canManageAgreements: false,
    isCore: core,
    request,
  });

  // Folder rows in these scopes are Page rows except the synthetic project and
  // offering folders ("Projects" and "Education" list each workspace as a
  // folder whose id is the workspace id), and everything in My Drive, which is
  // the viewer's own.
  const syntheticIds = new Set([...projects.map((p) => p.id), ...offerings.map((o) => o.id)]);
  const pageFolderIds = new Set<string>();
  const rootIds = new Map<string, string>();
  for (const s of scopes) {
    if (s.rootFolderId) rootIds.set(s.id, s.rootFolderId);
    if (s.id === "mine") continue;
    for (const it of s.items) {
      if (it.type === "folder" && !syntheticIds.has(it.id)) pageFolderIds.add(it.id);
    }
  }
  const accessIds = [...pageFolderIds, ...rootIds.values()];
  const pages = accessIds.length
    ? await prisma.page.findMany({
        where: { id: { in: accessIds } },
        select: PAGE_ACCESS_SELECT,
      })
    : [];
  const access = await getPageAccessBulk(userId, pages, request);
  const canEdit = (id: string) => !!access.get(id)?.canEdit;

  const folderIds = new Set([...syntheticIds, ...[...pageFolderIds].filter(canEdit)]);
  for (const s of scopes) {
    if (s.id !== "mine") continue;
    for (const it of s.items) if (it.type === "folder") folderIds.add(it.id);
  }
  const driveIds = new Set(
    scopes.filter((s) => !s.rootFolderId || canEdit(s.rootFolderId)).map((s) => s.id),
  );

  let rows = keepWritable(buildPickerRows(scopes), { driveIds, folderIds });
  const params = new URL(request.url).searchParams;
  const moving = (params.get("moving") ?? "").split(",").filter(Boolean);
  if (moving.length) rows = applyMoveConstraint(rows, await moveConstraintFor(moving));
  const q = params.get("q");
  if (q) rows = searchRows(rows, q);

  return withCors(request, Response.json(rows));
}
