import { data, useLoaderData } from "react-router";
import type { Route } from "./+types/community.opportunities";
import { requireOpportunityViewer, canPostJob } from "~/community/lib/opportunities-viewer.server";
import { loadOpportunitiesPage, parseShow } from "~/community/lib/opportunities-feed.server";
import { runOpportunityAction } from "~/community/lib/opportunities-actions.server";
import { OpportunitiesView, type OpportunitiesPageData } from "~/community/components/opportunities/OpportunitiesView";

export const meta: Route.MetaFunction = () => [{ title: "Opportunities · DALI OS" }];

export const handle = {
  breadcrumb: () => "Opportunities",
};

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireOpportunityViewer(request);
  const show = parseShow(new URL(request.url).searchParams.get("show"));
  const page = await loadOpportunitiesPage(null, viewer, show);
  return { canPostJob: canPostJob(viewer), ...page };
}

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireOpportunityViewer(request);
  const result = await runOpportunityAction(request, viewer, await request.formData());
  return result.ok ? result : data({ ok: false as const }, { status: result.status });
}

export default function CommunityOpportunities() {
  const loaded = useLoaderData<typeof loader>();
  return <OpportunitiesView data={loaded as OpportunitiesPageData} />;
}
