import type { Route } from "./+types/community.opportunities";
import { ComingSoon } from "~/components/ComingSoon";
import { requireCommunityViewer } from "~/community/lib/community.server";

export const meta: Route.MetaFunction = () => [{ title: "Opportunities · DALI OS" }];

export const handle = {
  breadcrumb: () => "Opportunities",
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireCommunityViewer(request);
  return null;
}

export default function CommunityOpportunities() {
  return <ComingSoon title="Opportunities" description="Jobs, internships and other openings shared by the DALI community." />;
}
