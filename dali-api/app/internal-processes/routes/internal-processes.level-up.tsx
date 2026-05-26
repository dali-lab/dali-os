import { redirect } from "react-router";
import type { Route } from "./+types/internal-processes.level-up";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect("/projects/level-up" + url.search);
}

export default function LevelUpRedirect() {
  return null;
}
