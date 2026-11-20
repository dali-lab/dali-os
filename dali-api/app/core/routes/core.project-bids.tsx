import { useLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/core.project-bids";
import { coreHandle } from "~/core/coreNav";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { loadSlotBoard, slotBoardAction } from "~/projects/lib/slot-board-page.server";
import { StaffingBoardPage } from "~/projects/components/StaffingBoardPage";

const SLOT = "project-bids" as const;

export const handle = coreHandle(SLOT);

export const meta: Route.MetaFunction = () => [{ title: "Project Bids · DALI OS" }];

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, ["term"]);
}

export async function loader({ request }: Route.LoaderArgs) {
  return loadSlotBoard(request, SLOT);
}

export async function action({ request }: Route.ActionArgs) {
  return slotBoardAction(request, SLOT, { managersOnly: true });
}

export default function ProjectBidsDatabase() {
  const data = useLoaderData<typeof loader>();
  return <StaffingBoardPage data={data} slot={SLOT} label="Project Bids" emptyLabel="bid" />;
}
