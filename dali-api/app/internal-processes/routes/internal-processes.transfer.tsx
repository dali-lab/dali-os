import { redirect } from "react-router";
import type { Route } from "./+types/internal-processes.transfer";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { ComingSoon } from "~/components/ComingSoon";

export const meta: Route.MetaFunction = () => [
  { title: "Transfer · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  // Transfer now hangs off Projects for everyone — the Lab Processes area it
  // used to live in is gone in both flag states, so this is a plain move, not
  // a regroup-gated one. /projects/transfer re-exports this same loader; the
  // path guard is what stops it redirecting to itself.
  if (new URL(request.url).pathname.startsWith("/internal-processes/")) {
    return redirect("/projects/transfer");
  }
  return null;
}

export default function InternalProcessesTransfer() {
  return (
    <div className="flex flex-col gap-4">
      <ComingSoon
        title="Transfer"
        description="Move members between domains or teams."
      />
    </div>
  );
}
