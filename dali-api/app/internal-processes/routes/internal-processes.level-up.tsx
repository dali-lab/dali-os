import { redirect } from "react-router";
import type { Route } from "./+types/internal-processes.level-up";
import { requireAuth } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [
  { title: "Level Up · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

export default function InternalProcessesLevelUp() {
  return (
    <ComingSoon
      title="Level Up"
      description="Member promotion and advancement requests."
    />
  );
}
