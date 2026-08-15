import { prisma } from "~/lib/db";

// Breadcrumb ancestry for an item that lives in the Drive tree. Walks up the
// Page folder chain from `folderPageId` to the (scoped) root, so a document,
// file, form, agreement or rubric can show its real folder path — Drive ▸
// Folder ▸ Subfolder ▸ item — instead of just Drive ▸ item.
//
// The Core/Hiring scoped roots are represented by the drive scope itself (not a
// crumb), so they're detected by systemKey and excluded from the chain while
// setting the scope. Everything else is a Lab-scope folder.

export type DriveCrumb = { id: string; title: string; iconEmoji: string | null };

export type DriveCrumbs = {
  /** Drive scope the item lives in: "lab" | "core" | "hiring". */
  scope: string;
  /** Ancestor folders, top-most first (excludes the scoped root itself). */
  folders: DriveCrumb[];
};

const MAX_DEPTH = 12; // guards against cyclic/broken parent chains

export async function driveFolderCrumbs(
  folderPageId: string | null | undefined,
): Promise<DriveCrumbs> {
  if (!folderPageId) return { scope: "lab", folders: [] };

  const chain: DriveCrumb[] = [];
  let scope = "lab";
  let cursor: string | null = folderPageId;

  for (let i = 0; i < MAX_DEPTH && cursor; i++) {
    const p: {
      id: string;
      title: string;
      iconEmoji: string | null;
      parentPageId: string | null;
      systemKey: string | null;
    } | null = await prisma.page.findUnique({
      where: { id: cursor },
      select: { id: true, title: true, iconEmoji: true, parentPageId: true, systemKey: true },
    });
    if (!p) break;
    // The scoped roots are shown as the drive itself, not as a folder crumb.
    if (p.systemKey === "drive:core-root") {
      scope = "core";
      break;
    }
    if (p.systemKey === "drive:hiring-root") {
      scope = "hiring";
      break;
    }
    chain.unshift({ id: p.id, title: p.title, iconEmoji: p.iconEmoji });
    cursor = p.parentPageId;
  }

  return { scope, folders: chain };
}

/** The "Drive" root crumb + each ancestor folder, as plain {label, to} entries
 *  rooted at the Drive hub. Folders deep-link into the Drive folder view. */
export function driveCrumbTrail(crumbs: DriveCrumbs): { label: string; to: string; id?: string }[] {
  const scopeQuery = crumbs.scope === "lab" ? "" : `?scope=${crumbs.scope}`;
  const root = { label: "Drive", to: `/drive${scopeQuery}` };
  const folders = crumbs.folders.map((f) => ({
    label: f.title || "Untitled folder",
    to: `/drive?scope=${crumbs.scope}&folder=${f.id}`,
    id: f.id,
  }));
  return [root, ...folders];
}
