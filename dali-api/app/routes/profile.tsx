import { redirect, useActionData, useLoaderData } from "react-router";
import { requireAuth } from "~/lib/auth";
import { MemberProfileView } from "~/members/components/MemberProfileView";
import {
  loadProfilePage,
  runProfileAction,
} from "~/members/lib/profile-page.server";
import type { Route } from "./+types/profile";

export const meta: Route.MetaFunction = () => [{ title: "Profile · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const targetId = await resolveSelfId(request);
  return loadProfilePage({ request, targetId });
}

export async function action({ request }: Route.ActionArgs) {
  const targetId = await resolveSelfId(request);
  return runProfileAction({ request, targetId });
}

export default function Profile() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <MemberProfileView
      data={data}
      actionError={
        actionData && "error" in actionData ? actionData.error : null
      }
    />
  );
}

// /profile always resolves to the signed-in user. loadProfilePage /
// runProfileAction will requireAuth again, but doing it once up front lets
// the shared helpers stay route-agnostic (they take an explicit target id).
async function resolveSelfId(request: Request): Promise<string> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/login");
  if (auth.user.type === "applicant") throw redirect("/portal");
  return auth.user.sub;
}
