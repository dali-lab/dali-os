import { redirect } from "react-router";
import type { Route } from "./+types/internal-processes.transfer";
import { requireAuth } from "~/lib/auth";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [
  { title: "Transfer · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

export default function InternalProcessesTransfer() {
  return (
    <ComingSoon
      title="Transfer"
      description="Move members between domains or teams."
    />
  );
}
