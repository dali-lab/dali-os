import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import type { Route } from "./+types/profile";

// /profile is just an alias for /members/<self>. The two pages render the
// same component now, and keeping /profile as a distinct view splits the
// presence room (each user lands on /presence:member:<their-own-id>), so
// nobody ever sees anyone else when both viewers are on /profile.
// Redirecting consolidates everything onto the canonical member URL.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;
  return redirect(`/members/${auth.user.sub}`);
}

// React Router requires a default export on a route module. The loader
// always redirects before this renders, so it's just a placeholder.
export default function Profile() {
  return null;
}
