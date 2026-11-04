import { redirect } from "react-router";
import type { Route } from "./+types/help.$slug";

export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/help/articles/${params.slug}`, 301);
}
