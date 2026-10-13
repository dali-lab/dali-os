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
  return { isAdmin: await isAdmin(auth.user.sub), processId: CORE_PROCESS_ID };
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
      <DriveReceivers processType="Core" processId={processId} title="Receiver folders" className="mt-6" />
    </div>
  );
}
