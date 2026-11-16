import type { Route } from "./+types/api.mentorship.warnings";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { canViewMentorship } from "../lib/visibility";
import { canWarnMember } from "../lib/warnings.server";
import { validateWarning, type WarningReason } from "../lib/warnings";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (!(await canViewMentorship(userId))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const input = {
    memberId: typeof body?.memberId === "string" ? body.memberId : "",
    reason: (typeof body?.reason === "string" ? body.reason : "") as WarningReason,
    notes: typeof body?.notes === "string" ? body.notes.trim() : "",
    occurredOn: typeof body?.occurredOn === "string" ? body.occurredOn : "",
  };
  const invalid = validateWarning(input);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  if (!(await canWarnMember(userId, input.memberId))) {
    return Response.json({ error: "You can only submit warnings for your own mentees." }, { status: 403 });
  }

  const warning = await prisma.mentorshipWarning.create({
    data: {
      memberId: input.memberId,
      reason: input.reason,
      notes: input.notes,
      occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
      createdById: userId,
    },
    select: { id: true },
  });
  return Response.json({ id: warning.id }, { status: 201 });
}
