// Breadcrumb ancestry for a Drive page that opens on its own surface (a
// whiteboard, a slide deck): the owning hub for project and offering pages,
// then the Drive folder path, ending at the page itself.

import type { ReactNode } from "react";
import { driveRootCrumbs } from "~/lib/drive-crumbs";
import { ProjectIcon } from "~/components/ProjectIcon";
import { FolderIcon } from "~/components/FolderIcon";

export type DrivePageAncestry = {
  title: string;
  iconEmoji: string | null;
  workspaceType: string;
  hubName: string | null;
  hubHref: string | null;
  hubIconEmoji: string | null;
  driveCrumbs: { scope: string; folders: { id: string; title: string; iconEmoji: string | null }[] } | null;
};

export function drivePageTrail(d: Partial<DrivePageAncestry> | undefined, leafIcon: ReactNode) {
  if (!d?.title) return null;
  const folders = d.driveCrumbs?.folders ?? [];
  const leaf = { label: d.title, icon: leafIcon };
  // Lab and personal pages root at Drive, then walk the folder path.
  if (!d.hubName || !d.hubHref) {
    const scope = d.driveCrumbs?.scope ?? "lab";
    return [
      ...driveRootCrumbs(scope),
      ...folders.map((f) => ({
        label: f.title || "Untitled folder",
        to: `/drive?scope=${scope}&folder=${f.id}`,
        icon: <FolderIcon iconEmoji={f.iconEmoji} />,
      })),
      leaf,
    ];
  }
  // Project and offering pages root at their hub.
  const isOffering = d.workspaceType === "EducationOffering";
  const driveScope = isOffering ? "education" : "projects";
  return [
    isOffering ? { label: "Education", to: "/education" } : { label: "Projects", to: "/projects" },
    { label: d.hubName, to: d.hubHref, icon: isOffering ? undefined : <ProjectIcon iconEmoji={d.hubIconEmoji} /> },
    ...folders.map((f) => ({
      label: f.title || "Untitled folder",
      to: `/drive?scope=${driveScope}&folder=${f.id}`,
      icon: <FolderIcon iconEmoji={f.iconEmoji} />,
    })),
    leaf,
  ];
}
