import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.$offeringId.hub";
import { OfferingHubView } from "~/education/components/OfferingHubView";
import { loadHub, hubAction } from "~/education/lib/offering-surface.server";
import { MEMBER_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(MEMBER_SURFACE, data?.hub.offering.title ?? "Course") },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
  // Flat routes drop the opaque :offeringId, so the offering's own landing page
  // (/education/:id) can't appear from the segment walk — declare the trail so
  // the hub links back up to it (replacing the old inline "Offering details").
  breadcrumbTrail: (
    data: { hub: { offering: { id: string; title: string } } } | undefined,
  ) => {
    if (!data) return null;
    const { id, title } = data.hub.offering;
    return [
      { label: "Education", to: "/education" },
      { label: title, to: `/education/${id}` },
      { label: "Course hub" },
    ];
  },
};

export const loader = (args: Route.LoaderArgs) => loadHub(args, MEMBER_SURFACE);

export const action = (args: Route.ActionArgs) => hubAction(args, MEMBER_SURFACE);

export default function MemberCourseHub() {
  return <OfferingHubView surface={MEMBER_SURFACE} {...useLoaderData<typeof loader>()} />;
}
