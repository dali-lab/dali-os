import { useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.page.$pageId";
import { OfferingPageView } from "~/education/components/OfferingPageView";
import { loadMaterialPage } from "~/education/lib/offering-surface.server";
import { PORTAL_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(PORTAL_SURFACE, data?.page.title ?? "Page") },
];

export const loader = (args: Route.LoaderArgs) => loadMaterialPage(args, PORTAL_SURFACE);

export default function PortalMaterialPage() {
  return <OfferingPageView surface={PORTAL_SURFACE} {...useLoaderData<typeof loader>()} />;
}
