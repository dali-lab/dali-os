// Client-safe Drive breadcrumb helpers. The folder-chain walk lives in
// drive-crumbs.server.ts (it hits Prisma); this file holds only pure label/link
// builders so a route's `handle.breadcrumbTrail` — which runs in the browser —
// can build the Drive root without pulling the server module (and Prisma) into
// the client bundle.

export type DriveRootCrumb = { label: string; to: string };

/** The Drive space a page's workspace maps to, or null for Lab pages — whose
 *  scope (lab / core / hiring) depends on the folder chain and is resolved by
 *  driveFolderCrumbs. Shared so the crumb walk and the doc-folder redirect agree. */
export function workspaceDriveScope(
  workspaceType: string | null | undefined,
): "mine" | "projects" | "education" | null {
  if (workspaceType === "Member") return "mine";
  if (workspaceType === "Project") return "projects";
  if (workspaceType === "EducationOffering") return "education";
  return null;
}

// The "Drive" root crumb, plus a visible scope crumb for the scoped drives so an
// item viewer's breadcrumb matches what the Drive browser itself shows
// (Drive ▸ Core ▸ Folder ▸ …) instead of hiding the scope behind a bare "Drive".
// Plain Lab items stay on "Drive"; every other scope carries its space crumb so
// the folder links below resolve to the space the item actually lives in.
export function driveRootCrumbs(scope: string | null | undefined): DriveRootCrumb[] {
  const root = { label: "Drive", to: "/drive" };
  if (scope === "core") return [root, { label: "Core", to: "/drive?scope=core" }];
  if (scope === "hiring") return [root, { label: "Hiring", to: "/drive?scope=hiring" }];
  if (scope === "mine") return [root, { label: "My Drive", to: "/drive?scope=mine" }];
  if (scope === "projects") return [root, { label: "Projects", to: "/drive?scope=projects" }];
  if (scope === "education") return [root, { label: "Education", to: "/drive?scope=education" }];
  return [root];
}
