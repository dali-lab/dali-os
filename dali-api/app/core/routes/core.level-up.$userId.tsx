import type { Route } from "./+types/core.level-up.$userId";
import { redirectToBoardDetail } from "~/projects/lib/slot-board-page.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return redirectToBoardDetail(request, "level-up", params.userId);
}
