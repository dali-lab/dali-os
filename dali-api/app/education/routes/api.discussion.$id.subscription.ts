import type { Route } from "./+types/api.discussion.$id.subscription";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { setSubscribed } from "~/education/lib/discussions-data";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Viewer must be Approved on the offering or able to manage it.
  const top = await prisma.educationDiscussionPost.findUnique({
    where: { id: params.id },
    select: { offeringId: true, parentPostId: true },
  });
  if (!top) return Response.json({ error: "Not found" }, { status: 404 });

  const isManager = await canManageOffering(auth.user.sub, top.offeringId);
  if (!isManager) {
    const app = await prisma.educationApplication.findUnique({
      where: {
        applicantUserId_offeringId: {
          applicantUserId: auth.user.sub,
          offeringId: top.offeringId,
        },
      },
      select: { status: true },
    });
    if (!app || app.status !== "Approved") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    await setSubscribed(params.id, auth.user.sub, request.method === "POST");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Subscribe failed" },
      { status: 400 },
    );
  }
}
