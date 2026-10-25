// Roles & permissions and Domains are one page now, at /core/access.
import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
  return redirect(`/core/access${new URL(request.url).search}`);
}
