import { Outlet } from "react-router";
import type { Route } from "./+types/core.communications";
import { coreClusterByKey, coreHandle } from "~/core/coreNav";
import { requireCommsViewer } from "~/core/lib/communications.server";
import { useFeatureFlags } from "~/components/FeatureFlags";
import { OsSectionHead } from "~/components/os-section";

export const handle = coreHandle("communications");

export const meta: Route.MetaFunction = () => [
  { title: "Communications · Core · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireCommsViewer(request);
  return { isAdmin: viewer.roles.isAdmin };
}

export default function CoreCommunicationsLayout() {
  const cluster = coreClusterByKey("communications")!;
  const flags = useFeatureFlags();
  const tabs = cluster.sections
    .filter((s) => !s.flag || flags[s.flag])
    .map((s) => ({ key: s.key, label: s.label, to: s.to }));
  return (
    <div className="flex flex-col gap-8">
      <OsSectionHead
        title={cluster.label}
        description={cluster.description}
        tabsLabel="Communications tools"
        tabs={tabs}
      />
      <Outlet />
    </div>
  );
}
