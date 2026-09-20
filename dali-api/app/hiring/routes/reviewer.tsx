import { redirect } from "react-router";
import type { Route } from "./+types/reviewer";

// Reviews moved onto My work (/hiring). Keep old links working, including
// ?cycle= and the old ?view=delibs.
export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  params.set("view", params.get("view") === "delibs" ? "delibs" : "reviews");
  return redirect(`/hiring?${params}`);
}

export default function ReviewerRedirect() {
  return null;
}
