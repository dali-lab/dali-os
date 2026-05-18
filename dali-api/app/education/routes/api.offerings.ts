import type { Route } from "./+types/api.offerings";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, currentTerm } from "~/lib/roles";

interface CreateOfferingPayload {
  type: "Miniseries" | "Workshop";
  title: string;
  capacity: number;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
  endsAt: string;
  requiresReview: boolean;
  calendarEmail?: string | null;
}

// POST /api/education/offerings — create a new offering. Only Core may
// create offerings (instructors get added separately and can then teach).
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CreateOfferingPayload;
  if (!body.title?.trim() || !Number.isFinite(body.capacity) || body.capacity < 1) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const offering = await prisma.educationOffering.create({
    data: {
      type: body.type,
      title: body.title.trim(),
      capacity: Math.floor(body.capacity),
      registrationOpensAt: new Date(body.registrationOpensAt),
      registrationClosesAt: new Date(body.registrationClosesAt),
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      requiresReview: !!body.requiresReview,
      calendarEmail: body.calendarEmail?.trim() || null,
      status: "Draft",
    },
  });

  // Auto-assign the creator as the first instructor so they can manage
  // the offering they just created.
  const term = await currentTerm();
  if (term) {
    await prisma.instructorAssignment.create({
      data: {
        userId: auth.user.sub,
        offeringId: offering.id,
        termId: term.id,
      },
    });
  }

  return Response.json({ offering }, { status: 201 });
}
