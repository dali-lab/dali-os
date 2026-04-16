import type { Route } from "./+types/api.reviews.$id.submit";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  const review = await prisma.applicationReview.findUnique({
    where: { id: params.id },
  });
  if (!review) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  if (review.submittedAt) {
    return Response.json({ error: "Review already submitted" }, { status: 409 });
  }

  const updated = await prisma.applicationReview.update({
    where: { id: params.id },
    data: {
      submittedAt: new Date(),
      submittedById: member.id,
    },
  });

  return Response.json(updated);
}
