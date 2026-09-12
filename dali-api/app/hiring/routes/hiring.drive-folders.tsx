// Hiring ▸ Drive folders — the management surface for the lab-wide Hiring folder
// set (the HiringCycle / HIRING_PROCESS_ID singleton; see app/lib/bindings.server.ts).
// Each slot — Hiring forms, Application templates, Rubrics — points at a NORMAL
// Drive folder that receives that artifact type's auto-filed items. This is the
// Hiring equivalent of Core ▸ Drive folders; it's the only place to repoint,
// create, or clear the Hiring bindings. Point several slots at one folder to keep
// everything in a single "Hiring" folder, or spread them out.
//
// Access/sharing of a bound folder is a separate control — open the folder in
// Drive and use Share. These folders default to a Core-group scope when created.

import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/hiring.drive-folders";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
// bindings.server is server-only; HIRING_PROCESS_ID is read in the loader (not the
// component) so React Router strips this import from the client bundle.
import { HIRING_PROCESS_ID } from "~/lib/bindings.server";
import { DriveFolderBindings } from "~/components/drive/DriveFolderBindings";

export const meta: Route.MetaFunction = () => [{ title: "Drive folders · Hiring · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return { processId: HIRING_PROCESS_ID };
}

export default function HiringDriveFoldersPage() {
  const { processId } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900">Drive folders</h1>
      <p className="mt-1 text-sm text-gray-500">
        Where hiring auto-files its shared artifacts — challenge/application forms, application
        templates, and rubrics. Point each at any Drive folder, or let DALI create one. These are
        normal folders: rename, move, or share them like anything else in Drive.
      </p>
      <DriveFolderBindings processType="HiringCycle" processId={processId} className="mt-6" />
    </div>
  );
}
