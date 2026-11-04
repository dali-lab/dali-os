import type { Route } from "./+types/core.communications.banners";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { prisma } from "~/lib/db.server";
import { coreHandle } from "~/core/coreNav";
import { requireCommsViewer } from "~/core/lib/communications.server";
import { listBanners } from "~/core/lib/banners.server";
import { BannersList } from "~/core/components/banners/BannersList";

export const handle = coreHandle("communications");

export const meta: Route.MetaFunction = () => [{ title: "Banners · Core · DALI OS" }];

// The status filter is client side.
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, []);
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireCommsViewer(request, "banners");
  const banners = await listBanners();
  const groupIds = [...new Set(banners.flatMap((b) => b.groupIds))];
  const groups = groupIds.length
    ? await prisma.groupDefinition.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } })
    : [];
  return { banners, groups, now: new Date().toISOString() };
}

export default function BannersRoute({ loaderData }: Route.ComponentProps) {
  return <BannersList data={loaderData} />;
}
