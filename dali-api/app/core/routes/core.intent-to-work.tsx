import { useLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/core.intent-to-work";
import { coreHandle } from "~/core/coreNav";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { resyncIntentSets } from "~/projects/lib/intent-validation";
import { loadSlotBoard, slotBoardAction } from "~/projects/lib/slot-board-page.server";
import { StaffingBoardPage } from "~/projects/components/StaffingBoardPage";

const SLOT = "intent-to-work" as const;

export const handle = coreHandle(SLOT);

export const meta: Route.MetaFunction = () => [{ title: "Intent to Work · DALI OS" }];

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, ["term"]);
}

export async function loader({ request }: Route.LoaderArgs) {
  return loadSlotBoard(request, SLOT, { withTermColumns: true });
}

export async function action({ request }: Route.ActionArgs) {
  return slotBoardAction(request, SLOT, {
    managersOnly: true,
    onMappingSaved: (cycleId, mapping) => resyncIntentSets(cycleId, mapping),
  });
}

export default function IntentToWorkDatabase() {
  const data = useLoaderData<typeof loader>();
  return <StaffingBoardPage data={data} slot={SLOT} label="Intent to Work" emptyLabel="intent" />;
}
