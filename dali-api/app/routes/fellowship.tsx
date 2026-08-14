import { useLoaderData } from "react-router";
import type { Route } from "./+types/fellowship";
import {
  loadInternalCyclePortal,
  handleInternalCyclePortalAction,
} from "~/hiring/lib/internal-cycle-portal.server";
import {
  InternalCyclePortalView,
  type PortalCopy,
} from "~/hiring/components/InternalCyclePortalView";

export const meta: Route.MetaFunction = () => [{ title: "Fellowship · DALI OS" }];

// The *internal* applicant portal for Fellowship cycles. Lives under the
// authenticated app layout (Google OAuth member session), intentionally not
// reachable from the CAS-authed /portal flow (that flow exists for external
// applicants). Loader/action logic is shared with Core via
// internal-cycle-portal.server.ts.
export async function loader({ request }: Route.LoaderArgs) {
  return loadInternalCyclePortal(request, "Fellowship");
}

export async function action({ request }: Route.ActionArgs) {
  return handleInternalCyclePortalAction(request, "Fellowship");
}

const COPY: PortalCopy = {
  heading: "Fellowship Application",
  notMember: "This page is only available to current DALI members.",
  notEligible:
    "Fellowship applications are only open to members currently in an intern-program domain (ERAS, EEJUST, WISP) during an active term.",
  noActiveCycleTitle: "No open fellowship cycle",
  noActiveCycleBody:
    "There's no fellowship application cycle open right now. The hiring leads will let interns know when one opens.",
  submittedBody:
    "Your fellowship application is in. Hiring leads will review it and reach out with a decision.",
  withdrawnBody:
    "You withdrew this fellowship application. Contact the hiring lead if you want to reopen it.",
  contextHint: (domains) => (
    <>
      You're currently in{" "}
      {domains.map((d, i) => (
        <span key={d.id}>
          <span className="font-medium text-dark-blue">{d.displayName}</span>
          {i < domains.length - 1 ? ", " : ""}
        </span>
      ))}
      .
    </>
  ),
  domainSectionHint:
    "Pick the domain(s) you'd like to be considered for. You can pick more than one.",
};

export default function FellowshipRoute() {
  const data = useLoaderData<typeof loader>();
  return <InternalCyclePortalView data={data} copy={COPY} />;
}
