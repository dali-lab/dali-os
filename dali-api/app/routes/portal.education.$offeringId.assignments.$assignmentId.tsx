import { useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.assignments.$assignmentId";
import { AssignmentView } from "~/education/components/AssignmentView";
import { loadAssignment, submitAssignmentAction } from "~/education/lib/offering-surface.server";
import { PORTAL_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(PORTAL_SURFACE, data?.assignment.title ?? "Assignment") },
];

export const loader = (args: Route.LoaderArgs) => loadAssignment(args, PORTAL_SURFACE);

export const action = (args: Route.ActionArgs) => submitAssignmentAction(args, PORTAL_SURFACE);

export default function PortalAssignment() {
  return <AssignmentView surface={PORTAL_SURFACE} {...useLoaderData<typeof loader>()} />;
}
