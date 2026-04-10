import type { Route } from "./+types/home";

export function loader({}: Route.LoaderArgs) {
  return Response.json({ status: "ok", service: "dali-api" });
}
