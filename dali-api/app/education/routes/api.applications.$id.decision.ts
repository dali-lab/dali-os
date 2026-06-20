import type { Route } from "./+types/api.applications.$id.decision";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { promoteFromWaitlist } from "~/education/lib/promotion.server";
import { notifyApplicationStatus } from "~/education/lib/notifications";
import { logAuditEvent } from "~/lib/audit";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

const VALID: EduApplicationStatus[] = ["Approved", "Rejected", "Waitlisted", "Withdrawn"];

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const target = body?.status as EduApplicationStatus | undefined;
  if (!target || !VALID.includes(target)) {
    return Response.json({ error: `status must be one of ${VALID.join(", ")}` }, { status: 400 });
  }

  const app = await prisma.educationApplication.findUnique({
    where: { id: params.id },
    include: { offering: { select: { id: true, title: true } } },
  });
  if (!app) return Response.json({ error: "Application not found" }, { status: 404 });

  const isOwner = app.applicantUserId === auth.user.sub;
  const isManager = await canManageOffering(auth.user.sub, app.offering.id);

  // Applicants can only withdraw their own application. Managers can do
  // anything else.
  if (target === "Withdrawn") {
    if (!isOwner && !isManager) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    if (!isManager) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const previousStatus = app.status;

  const updated = await prisma.educationApplication.update({
    where: { id: app.id },
    data: {
      status: target,
      reviewedAt: new Date(),
      reviewedBy: auth.user.sub,
    },
  });

  // Promote off the waitlist if a seat just freed (someone Approved transitioned
  // to Withdrawn or Rejected). For brand-new Approved transitions, no promotion
  // needed.
  let promoted: { promotedApplicationId: string | null; promotedUserId: string | null } = {
    promotedApplicationId: null,
    promotedUserId: null,
  };
  if (previousStatus === "Approved" && (target === "Withdrawn" || target === "Rejected")) {
    promoted = await promoteFromWaitlist(app.offering.id);
  }

  const baseLink = isOwner && auth.user.type === "applicant"
    ? `/portal/education/${app.offering.id}/enrolled`
    : `/education/enrolled/${app.offering.id}`;

  try {
    await notifyApplicationStatus({
      applicantUserId: app.applicantUserId,
      offeringTitle: app.offering.title,
      status: target,
      offeringId: app.offering.id,
      enrolledLink: target === "Approved" ? baseLink : null,
      reason: "decision",
    });
  } catch (err) {
    console.error("[education] decision notify failed:", err);
  }

  if (promoted.promotedApplicationId && promoted.promotedUserId) {
    try {
      await notifyApplicationStatus({
        applicantUserId: promoted.promotedUserId,
        offeringTitle: app.offering.title,
        status: "Approved",
        offeringId: app.offering.id,
        enrolledLink: `/education/enrolled/${app.offering.id}`,
        reason: "waitlist_promoted",
      });
    } catch (err) {
      console.error("[education] promotion notify failed:", err);
    }
  }

  await logAuditEvent({
    action: "education.application.decision",
    userId: auth.user.sub,
    targetId: app.id,
    metadata: {
      offeringId: app.offering.id,
      previousStatus,
      newStatus: target,
      promotedApplicationId: promoted.promotedApplicationId,
    },
    request,
  });

  return Response.json({ application: updated, promoted });
}
