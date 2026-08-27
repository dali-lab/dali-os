import { redirect } from "react-router";
import type { Route } from "./+types/core.level-up";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect("/core/growth" + url.search);
}

export default function LevelUpRedirect() {
  return null;
}
