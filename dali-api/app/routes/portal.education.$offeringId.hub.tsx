import { useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.hub";
import { OfferingHubView } from "~/education/components/OfferingHubView";
import { loadHub, hubAction } from "~/education/lib/offering-surface.server";
import { PORTAL_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(PORTAL_SURFACE, data?.hub.offering.title ?? "Course") },
];

export const loader = (args: Route.LoaderArgs) => loadHub(args, PORTAL_SURFACE);

export const action = (args: Route.ActionArgs) => hubAction(args, PORTAL_SURFACE);

export default function PortalCourseHub() {
  return <OfferingHubView surface={PORTAL_SURFACE} {...useLoaderData<typeof loader>()} />;
}
