import { redirect } from "react-router";
import type { Route } from "./+types/core.level-up.$userId";

export async function loader({ params }: Route.LoaderArgs) {
  return redirect(`/core/growth/${params.userId}`);
}

export default function LevelUpUserRedirect() {
  return null;
}
