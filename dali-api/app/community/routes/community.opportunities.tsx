import { data, useLoaderData } from "react-router";
import type { Route } from "./+types/community.opportunities";
import { ComingSoon } from "~/components/ComingSoon";
import { requireOpportunityViewer, requireOpportunityViewerEnabled, canPostJob } from "~/community/lib/opportunities-viewer.server";
import { loadOpportunitiesPage, parseShow } from "~/community/lib/opportunities-feed.server";
import { runOpportunityAction } from "~/community/lib/opportunities-actions.server";
import { OpportunitiesView, type OpportunitiesPageData } from "~/community/components/opportunities/OpportunitiesView";

export const meta: Route.MetaFunction = () => [{ title: "Opportunities · DALI OS" }];

export const handle = {
  breadcrumb: () => "Opportunities",
};

export async function loader({ request }: Route.LoaderArgs) {
  const { viewer, enabled } = await requireOpportunityViewer(request);
  if (!enabled) return { enabled: false as const };
  const show = parseShow(new URL(request.url).searchParams.get("show"));
  const page = await loadOpportunitiesPage(null, viewer, show);
  return { enabled: true as const, canPostJob: canPostJob(viewer), ...page };
}

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireOpportunityViewerEnabled(request);
  const result = await runOpportunityAction(request, viewer, await request.formData());
  return result.ok ? result : data({ ok: false as const }, { status: result.status });
}

export default function CommunityOpportunities() {
  const loaded = useLoaderData<typeof loader>();
  if (!loaded.enabled) {
    return <ComingSoon title="Opportunities" description="Jobs, internships and other openings shared by the DALI community." />;
  }
  return <OpportunitiesView data={loaded as OpportunitiesPageData} />;
}
