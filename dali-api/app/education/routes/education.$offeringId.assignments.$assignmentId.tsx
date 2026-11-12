import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.$offeringId.assignments.$assignmentId";
import { AssignmentView } from "~/education/components/AssignmentView";
import { loadAssignment, submitAssignmentAction } from "~/education/lib/offering-surface.server";
import { MEMBER_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(MEMBER_SURFACE, data?.assignment.title ?? "Assignment") },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
  // Flat routes drop the opaque middle :offeringId, so the course would vanish
  // from the trail — declare the full trail back to the offering's assignments.
  breadcrumbTrail: (
    data:
      | {
          offeringId: string
          offeringTitle: string
          assignment: { title: string }
        }
      | undefined,
  ) => {
    if (!data) return null;
    const hub = `/education/${data.offeringId}/hub`;
    return [
      { label: "Education", to: "/education" },
      { label: data.offeringTitle, to: hub },
      { label: "Assignments", to: `${hub}?tab=assignments` },
      { label: data.assignment.title },
    ];
  },
};

export const loader = (args: Route.LoaderArgs) => loadAssignment(args, MEMBER_SURFACE);

export const action = (args: Route.ActionArgs) => submitAssignmentAction(args, MEMBER_SURFACE);

export default function MemberAssignment() {
  return <AssignmentView surface={MEMBER_SURFACE} {...useLoaderData<typeof loader>()} />;
}
