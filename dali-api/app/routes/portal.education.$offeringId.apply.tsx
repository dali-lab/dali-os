import { useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.apply";
import { ApplyView } from "~/education/components/ApplyView";
import { loadApply, submitApplyAction } from "~/education/lib/offering-surface.server";
import { PORTAL_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(PORTAL_SURFACE, `Apply · ${data?.offering.title ?? "Offering"}`) },
];

export const loader = (args: Route.LoaderArgs) => loadApply(args, PORTAL_SURFACE);

export const action = (args: Route.ActionArgs) => submitApplyAction(args, PORTAL_SURFACE);

export default function PortalApplyToOffering() {
  return <ApplyView surface={PORTAL_SURFACE} {...useLoaderData<typeof loader>()} />;
}
