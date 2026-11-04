// Confirmation page after a member submits a referral.

import { Link } from "react-router";
import { Check } from "lucide-react";
import type { Route } from "./+types/refer.done";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";

export const meta: Route.MetaFunction = () => [
  { title: "Referral submitted · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const redirectResp = await redirectNonMemberToPortal(auth, request);
  if (redirectResp) return redirectResp;
  return {};
}

export default function ReferDone() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-os-container text-foreground">
        <Check className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-semibold text-foreground">Referral in</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Partner Relations has been notified. They'll take it from here and ping
        you if they need more context. If and when the partner signs on with
        DALI, the bounty is yours.
      </p>
      <div className="flex items-center gap-3">
        <Link
          to="/refer"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Refer another partner
        </Link>
        <Link
          to="/"
          className="rounded-full border border-os-container px-4 py-2 text-sm text-foreground hover:bg-os-container/30"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
