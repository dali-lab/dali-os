import type { Crumb } from "~/components/Breadcrumbs";
import type { ItemLocation } from "~/components/drive/location";

/** A note's place for the shell's breadcrumb row: space, folders, notebook, then the tab. */
export function noteTrail(
  location: ItemLocation,
  notebook: { id: string; title: string },
  tabLabel: string,
): Crumb[] {
  const driveHref = (folderId: string | null) =>
    `/drive?scope=${location.scopeId}${folderId ? `&folder=${folderId}` : ""}`;
  return [
    { label: location.scopeLabel, to: driveHref(null) },
    ...location.folders.map((f) => ({ label: f.title, to: driveHref(f.id) })),
    { label: notebook.title, to: `/documents/${notebook.id}` },
    { label: tabLabel },
  ];
}
