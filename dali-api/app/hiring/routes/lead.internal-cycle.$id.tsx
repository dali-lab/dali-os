import { redirect } from "react-router";
import type { Route } from "./+types/lead.internal-cycle.$id";

// Interns and Lab members cycles share the one setup page now; keep old links
// (notifications, bookmarks, form-usage links) working.
export async function loader({ params, request }: Route.LoaderArgs) {
  const search = new URL(request.url).search;
  return redirect(`/hiring/lead/cycle/${params.id}${search}`);
}

export default function InternalCycleRedirect() {
  return null;
}
