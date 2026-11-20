import type { Route } from "./+types/core.intent-to-work.$userId";
import { redirectToBoardDetail } from "~/projects/lib/slot-board-page.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return redirectToBoardDetail(request, "intent-to-work", params.userId);
}
