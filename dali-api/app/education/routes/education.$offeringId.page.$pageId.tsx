import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.$offeringId.page.$pageId";
import { OfferingPageView } from "~/education/components/OfferingPageView";
import { loadMaterialPage } from "~/education/lib/offering-surface.server";
import { MEMBER_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(MEMBER_SURFACE, data?.page.title ?? "Page") },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
  // Flat routes don't nest, so the middle :offeringId is an opaque id the
  // segment walk drops — the course vanishes from the trail. Declare the full
  // trail so the page stays reachable from its offering.
  breadcrumbTrail: (
    data:
      | { offeringId: string; offeringTitle: string; page: { title: string } }
      | undefined,
  ) => {
    if (!data) return null;
    const hub = `/education/${data.offeringId}/hub`;
    return [
      { label: "Education", to: "/education" },
      { label: data.offeringTitle, to: hub },
      { label: "Sessions", to: `${hub}?tab=sessions` },
      { label: data.page.title },
    ];
  },
};

export const loader = (args: Route.LoaderArgs) => loadMaterialPage(args, MEMBER_SURFACE);

export default function MaterialPage() {
  return <OfferingPageView surface={MEMBER_SURFACE} {...useLoaderData<typeof loader>()} />;
}
