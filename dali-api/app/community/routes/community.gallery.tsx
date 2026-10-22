import type { Route } from "./+types/community.gallery";
import { ComingSoon } from "~/components/ComingSoon";
import { requireCommunityViewer } from "~/community/lib/community.server";

export const meta: Route.MetaFunction = () => [{ title: "Gallery · DALI OS" }];

export const handle = {
  breadcrumb: () => "Gallery",
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireCommunityViewer(request);
  return null;
}

export default function CommunityGallery() {
  return <ComingSoon title="Gallery" description="Photos and moments from around the lab." />;
}
