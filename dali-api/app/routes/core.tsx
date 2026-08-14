import { useLoaderData } from "react-router";
import type { Route } from "./+types/core";
import {
  loadInternalCyclePortal,
  handleInternalCyclePortalAction,
} from "~/hiring/lib/internal-cycle-portal.server";
import {
  InternalCyclePortalView,
  type PortalCopy,
} from "~/hiring/components/InternalCyclePortalView";

export const meta: Route.MetaFunction = () => [{ title: "Core Application · DALI OS" }];

// The internal applicant portal for Core cycles — open to all current lab
// members. Shares its loader/action/UI with Fellowship; Core just applies "to
// Core" (no target-domain picker — the single synthetic CORE domain is linked
// automatically).
export async function loader({ request }: Route.LoaderArgs) {
  return loadInternalCyclePortal(request, "Core");
}

export async function action({ request }: Route.ActionArgs) {
  return handleInternalCyclePortalAction(request, "Core");
}

const COPY: PortalCopy = {
  heading: "Core Application",
  notMember: "This page is only available to current DALI members.",
  notEligible: "Core applications are only open to current, active lab members.",
  noActiveCycleTitle: "No open Core cycle",
  noActiveCycleBody:
    "There's no Core application cycle open right now. Hiring leads will let the lab know when one opens.",
  submittedBody:
    "Your Core application is in. Reviewers will read it and you'll hear back with a decision.",
  withdrawnBody:
    "You withdrew this Core application. Contact the hiring lead if you want to reopen it.",
};

export default function CoreRoute() {
  const data = useLoaderData<typeof loader>();
  return <InternalCyclePortalView data={data} copy={COPY} />;
}
