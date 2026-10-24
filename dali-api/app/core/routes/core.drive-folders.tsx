// Core ▸ Drive folders — the management surface for the lab-wide "Core
// governance" receiver folders. Each Core
// process slot — Meeting notes, Agreements, Email templates, Education templates
// — points at a NORMAL Drive folder that receives that artifact type's auto-filed
// items. (Hiring artifacts have their own peer surface at /hiring/drive-folders.)
// This is the Core equivalent of the per-project / per-offering "Drive folders"
// settings sections; it's the only place to repoint, create, or clear the Core
// bindings (they used to be invisible systemKey scaffolding with no UI at all).
//
// Access/sharing of a bound folder is a separate control — open the folder in
// Drive and use Share. These folders default to a Core-group scope when created.

import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.drive-folders";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { CORE_PROCESS_ID } from "~/lib/process-ids";
import { DriveReceivers } from "~/components/drive/DriveReceivers";

export const handle = coreHandle("drive-folders");

export const meta: Route.MetaFunction = () => [{ title: "Drive folders · Core · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return {
    isAdmin: await isAdmin(auth.user.sub),
    processId: CORE_PROCESS_ID,
  };
}

export default function CoreDriveFoldersPage() {
  const { processId } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900">Drive folders</h1>
      <p className="mt-1 text-sm text-gray-500">
        Where Core files meeting notes, agreements, and templates. Each slot takes any folder inside
        Core, and you can also mark a folder from its Folder settings in Drive. Hiring has its own
        under Hiring ▸ Drive folders.
      </p>
      <DriveReceivers processType="Core" processId={processId} title="Folders" className="mt-6" />
    </div>
  );
}
