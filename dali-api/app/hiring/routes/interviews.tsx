import { redirect } from "react-router";
import type { Route } from "./+types/interviews";

// Interviews moved onto My work (/hiring). Keep old links working, including ?cycle=.
export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  params.set("view", "interviews");
  return redirect(`/hiring?${params}`);
}

export default function InterviewsRedirect() {
  return null;
}
