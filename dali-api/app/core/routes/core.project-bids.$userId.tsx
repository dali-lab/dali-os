import type { Route } from "./+types/core.project-bids.$userId";
import { redirectToBoardDetail } from "~/projects/lib/slot-board-page.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return redirectToBoardDetail(request, "project-bids", params.userId);
}
