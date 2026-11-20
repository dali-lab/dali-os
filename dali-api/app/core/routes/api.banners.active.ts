// GET /api/banners/active: the live banners the signed-in viewer should still
// see, for the BannerHost overlay.

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { activeBannersFor } from "~/core/lib/banners.server";

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ banners: [] }, { status: 401 });
  const roles = await getUserRoles(auth.user.sub, request);
  const banners = await activeBannersFor(auth.user.sub, roles);
  return Response.json({ banners }, { headers: { "Cache-Control": "private, no-store" } });
}
