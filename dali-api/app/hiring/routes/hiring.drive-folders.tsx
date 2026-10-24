// Hiring ▸ Drive folders: where hiring forms, application templates and
// rubrics land. The Hiring counterpart of Core ▸ Drive folders.

import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/hiring.drive-folders";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { HIRING_PROCESS_ID } from "~/lib/process-ids";
import { DriveReceivers } from "~/components/drive/DriveReceivers";

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
        Where hiring files its forms and application templates. Each slot takes any folder inside
        Hiring, and you can also mark a folder from its Folder settings in Drive.
      </p>
      <DriveReceivers processType="HiringCycle" processId={processId} title="Folders" className="mt-6" />
    </div>
  );
}
