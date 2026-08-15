// Client-safe Drive breadcrumb helpers. The folder-chain walk lives in
// drive-crumbs.server.ts (it hits Prisma); this file holds only pure label/link
// builders so a route's `handle.breadcrumbTrail` — which runs in the browser —
// can build the Drive root without pulling the server module (and Prisma) into
// the client bundle.

export type DriveRootCrumb = { label: string; to: string };

// The "Drive" root crumb, plus a visible scope crumb for the scoped drives so an
// item viewer's breadcrumb matches what the Drive browser itself shows
// (Drive ▸ Core ▸ Folder ▸ …) instead of hiding the scope behind a bare "Drive".
// Lab-scope items stay on plain "Drive": driveFolderCrumbs can't tell a private
// "My Drive" page from a Lab one, so a "Lab" label here could mislabel it.
export function driveRootCrumbs(scope: string | null | undefined): DriveRootCrumb[] {
  const root = { label: "Drive", to: "/drive" };
  if (scope === "core") return [root, { label: "Core", to: "/drive?scope=core" }];
  if (scope === "hiring") return [root, { label: "Hiring", to: "/drive?scope=hiring" }];
  return [root];
}
