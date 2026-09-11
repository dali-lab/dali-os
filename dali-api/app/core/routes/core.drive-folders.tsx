// Core ▸ Drive folders — the management surface for the lab-wide "Core
// governance" folder bindings (see app/lib/bindings.server.ts). Each Core
// process slot — Agreements, Email templates, Education templates, Rubrics,
// Application templates, Hiring forms — points at a NORMAL Drive folder that
// receives that artifact type's auto-filed items. This is the Core equivalent
// of the per-project / per-offering "Drive folders" settings sections; it's the
// only place to repoint, create, or clear the Core bindings (they used to be
// invisible systemKey scaffolding with no UI at all).
//
// Access/sharing of a bound folder is a separate control — open the folder in
// Drive and use Share. These folders default to a Core-group scope when created.

import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.drive-folders";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
// bindings.server is server-only; CORE_PROCESS_ID is read in the loader (not the
// component) so React Router strips this import from the client bundle.
import { CORE_PROCESS_ID } from "~/lib/bindings.server";
import { DriveFolderBindings } from "~/components/drive/DriveFolderBindings";

export const handle = coreHandle("drive-folders");

export const meta: Route.MetaFunction = () => [{ title: "Drive folders · Core · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return { isAdmin: await isAdmin(auth.user.sub), processId: CORE_PROCESS_ID };
}

export default function CoreDriveFoldersPage() {
  const { processId } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900">Drive folders</h1>
      <p className="mt-1 text-sm text-gray-500">
        Where Core auto-files shared lab artifacts — agreements, templates, rubrics, and hiring
        forms. Point each at any Drive folder, or let DALI create one. These are normal folders:
        rename, move, or share them like anything else in Drive.
      </p>
      <DriveFolderBindings processType="Core" processId={processId} className="mt-6" />
    </div>
  );
}
