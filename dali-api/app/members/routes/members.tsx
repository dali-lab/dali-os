import { redirect } from "react-router";
import type { Route } from "./+types/members";
import { requireAuth, withAuth } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [{ title: "Members · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (auth.user.type === "applicant") return withAuth(auth, redirect("/portal"));
  return withAuth(auth, null);
}

export default function MembersDirectory() {
  return (
    <ComingSoon
      title="Directory"
      description="Everyone in DALI — profiles, roles, and contact info."
    />
  );
}
