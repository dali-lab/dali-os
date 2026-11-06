import { redirect } from "react-router";
import type { Route } from "./+types/partner.login";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { pickSafeLoginNext } from "~/lib/login-next";

// Partners sign in on /login like everyone else. This path stays for old links
// and bookmarks.
export async function loader({ request }: Route.LoaderArgs) {
  const existingAuth = await requireAuth(request);
  if (!existingAuth.ok) {
    const next = pickSafeLoginNext(new URL(request.url).searchParams.get("next"));
    return redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  if (existingAuth.user.type === "member") return redirect("/");
  if (existingAuth.user.type === "dartmouth") return redirect("/portal");
  const partnerContact = await prisma.partnerContact.findUnique({
    where: { userId: existingAuth.user.sub },
    select: { id: true },
  });
  // A contact row means they've been through at least one auth flow previously;
  // the requirePartnerAccount guard will JIT-provision if anything is missing.
  return redirect(partnerContact ? "/partner" : "/partner/onboarding");
}
