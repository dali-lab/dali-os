// Drive-namespaced authoring route for agreement templates.
//
// Re-exports the admin.agreements.$id route action + component but provides
// its own loader that augments the admin loader's result with driveCrumbs so
// the breadcrumb shows the full Drive folder path instead of just the name.
//
// The redirect-loop guard lives in admin.agreements.$id.tsx: its loader only
// redirects when the request path starts with /admin/agreements, so wrapping
// that loader here is safe — loading /documents/agreement/:id will not redirect.

import type { Route } from "./+types/documents.agreement.$id";
import { loader as adminLoader } from "./admin.agreements.$id";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { driveRootCrumbs } from "~/lib/drive-crumbs";
import { requireAuth } from "~/lib/auth";
import { PageIcon } from "~/components/PageIcon";

export { action, default } from "./admin.agreements.$id";

export async function loader(args: Route.LoaderArgs) {
  const result = await adminLoader(args as unknown as Parameters<typeof adminLoader>[0]);
  // If the admin loader redirected, pass it through.
  if (result instanceof Response) return result;
  const doc = (result as { document?: { folderPageId?: string | null } }).document;
  // adminLoader has already authed this request; requireAuth just reads the sub.
  const auth = await requireAuth(args.request);
  const viewerSub = auth.ok ? auth.user.sub : "";
  const driveCrumbs = await driveFolderCrumbs(doc?.folderPageId, viewerSub, args.request);
  return { ...(result as object), driveCrumbs };
}

// Override the adminHandle breadcrumb trail (which roots at Admin) so the Drive
// surface shows "Drive › Folder › … › <agreement name>" instead of the admin trail.
export const handle = {
  docKey: "agreement.author",
  docTitle: "Agreements",
  breadcrumbTrail: (data: unknown) => {
    const d = data as {
      document?: { name?: string };
      driveCrumbs?: { scope: string; folders: { id: string; title: string; iconEmoji: string | null }[] } | null;
    } | undefined;
    const name = d?.document?.name;
    if (!name) return null;
    const scope = d?.driveCrumbs?.scope ?? "lab";
    return [
      ...driveRootCrumbs(scope),
      ...(d?.driveCrumbs?.folders ?? []).map((f) => ({
        label: f.title || "Untitled folder",
        to: `/drive?scope=${scope}&folder=${f.id}`,
        icon: <PageIcon iconEmoji={f.iconEmoji} />,
      })),
      { label: name },
    ];
  },
};
