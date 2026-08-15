import { redirect } from "react-router";
import type { Route } from "./+types/library";

export const handle = { areaPills: true };

export async function loader(_: Route.LoaderArgs) {
  return redirect("/drive");
}

export default function Library() {
  return null;
}
