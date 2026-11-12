import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.$offeringId.apply";
import { ApplyView } from "~/education/components/ApplyView";
import { loadApply, submitApplyAction } from "~/education/lib/offering-surface.server";
import { MEMBER_SURFACE, surfaceTitle } from "~/education/lib/offering-surface";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: surfaceTitle(MEMBER_SURFACE, `Apply · ${data?.offering.title ?? "Offering"}`) },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
  // /education/:offeringId/apply — the opaque :offeringId drops from the segment
  // walk, so declare the trail to keep the offering in the path.
  breadcrumbTrail: (data: unknown) => {
    const o = (
      data as { offering?: { id?: string; title?: string } } | undefined
    )?.offering;
    if (!o?.id) return null;
    return [
      { label: "Education", to: "/education" },
      { label: o.title ?? "Offering", to: `/education/${o.id}` },
      { label: "Apply" },
    ];
  },
};

export const loader = (args: Route.LoaderArgs) => loadApply(args, MEMBER_SURFACE);

export const action = (args: Route.ActionArgs) => submitApplyAction(args, MEMBER_SURFACE);

export default function ApplyToOffering() {
  return <ApplyView surface={MEMBER_SURFACE} {...useLoaderData<typeof loader>()} />;
}
