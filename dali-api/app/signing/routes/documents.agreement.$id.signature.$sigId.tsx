// Drive-namespaced signature view route — wraps the core implementation with
// a Drive-rooted breadcrumb trail so the signed-copy viewer shows
// "Drive › Folder › … › <agreement name> › Signed copy" rather than no crumb.
import type { Route } from "./+types/documents.agreement.$id.signature.$sigId";
import { loader as coreLoader } from "./core.agreements.$id.signature.$sigId";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { driveRootCrumbs } from "~/lib/drive-crumbs";
import { requireAuth } from "~/lib/auth";
import { PageIcon } from "~/components/PageIcon";
import { prisma } from "~/lib/db";

export { default } from "./core.agreements.$id.signature.$sigId";

export async function loader(args: Route.LoaderArgs) {
  const result = await coreLoader(args as unknown as Parameters<typeof coreLoader>[0]);
  if (result instanceof Response) return result;

  // Look up the agreement's folderPageId so we can build the Drive crumb trail.
  const docId = (result as { documentId?: string }).documentId;
  const auth = await requireAuth(args.request);
  const viewerSub = auth.ok ? auth.user.sub : "";

  let driveCrumbs = null;
  if (docId) {
    const doc = await prisma.signingDocument.findUnique({
      where: { id: docId },
      select: { folderPageId: true },
    });
    driveCrumbs = await driveFolderCrumbs(doc?.folderPageId, viewerSub, args.request);
  }

  return { ...(result as object), driveCrumbs };
}

export const handle = {
  breadcrumbTrail: (data: unknown) => {
    const d = data as {
      documentName?: string;
      documentId?: string;
      driveCrumbs?: { scope: string; folders: { id: string; title: string; iconEmoji: string | null }[] } | null;
    } | undefined;
    const name = d?.documentName;
    if (!name) return null;
    const scope = d?.driveCrumbs?.scope ?? "lab";
    return [
      ...driveRootCrumbs(scope),
      ...(d?.driveCrumbs?.folders ?? []).map((f) => ({
        label: f.title || "Untitled folder",
        to: `/drive?scope=${scope}&folder=${f.id}`,
        icon: <PageIcon iconEmoji={f.iconEmoji} />,
      })),
      {
        label: name,
        to: d?.documentId ? `/documents/agreement/${d.documentId}` : undefined,
      },
      { label: "Signed copy" },
    ];
  },
};
