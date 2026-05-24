import type { Route } from "./+types/api.domain-applications.$id.resend-invite";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { renderForSlot, notificationSlot } from "~/hiring/lib/email-variables";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!(await isCore(auth.user.sub))) {
    return Response.json(
      { error: "Only hiring leads can resend invites" },
      { status: 403 },
    );
  }

  const domainApp = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      challengeVersion: {
        include: { domain: { select: { id: true, name: true, displayName: true } } },
      },
      domain: { select: { id: true, name: true, displayName: true } },
      application: {
        include: {
          user: {
            select: {
              firstName: true,
              dartmouthEmail: true,
              netId: true,
            },
          },
        },
      },
      decisions: {
        where: { stage: "Released" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { type: true },
      },
      interviews: {
        where: { status: "Scheduled" },
        select: { id: true },
      },
    },
  });
  if (!domainApp) {
    return Response.json(
      { error: "Domain application not found" },
      { status: 404 },
    );
  }

  // Only meaningful when the applicant is currently sitting at "invited but
  // not booked". Latest released decision must be InvitedToInterview, and
  // there must be no Scheduled interview row already.
  if (domainApp.decisions[0]?.type !== "InvitedToInterview") {
    return Response.json(
      { error: "Applicant is not currently in the InvitedToInterview state." },
      { status: 409 },
    );
  }
  if (domainApp.interviews.length > 0) {
    return Response.json(
      { error: "An interview is already scheduled for this applicant." },
      { status: 409 },
    );
  }

  const targetDomain =
    domainApp.domain ?? domainApp.challengeVersion?.domain ?? null;
  if (!targetDomain) {
    return Response.json(
      { error: "Domain application has no linked domain." },
      { status: 409 },
    );
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    domainApp.application.applicationCycleId,
  );
  if (gate) return gate;

  const binding = await prisma.cycleNotificationEmail.findUnique({
    where: {
      applicationCycleId_notificationType: {
        applicationCycleId: domainApp.application.applicationCycleId,
        notificationType: "InterviewInviteReminder",
      },
    },
    include: { emailTemplateVersion: true },
  });
  if (!binding) {
    return Response.json(
      {
        error:
          "No email template is bound to InterviewInviteReminder in this cycle. Bind one on the Setup tab → Notification Emails.",
      },
      { status: 409 },
    );
  }

  const user = domainApp.application.user;
  const email =
    user?.dartmouthEmail ??
    (user?.netId ? `${user.netId}@dartmouth.edu` : null);
  if (!email || !user) {
    return Response.json(
      { error: "Applicant has no deliverable email address." },
      { status: 409 },
    );
  }

  const refreshToken = await getApplicationsGmailRefreshToken();
  if (!refreshToken) {
    return Response.json(
      { error: "Applications Gmail is not configured — cannot send email." },
      { status: 503 },
    );
  }

  const domainName = targetDomain.displayName ?? targetDomain.name ?? "";

  const { subject, html } = renderForSlot(
    notificationSlot("InterviewInviteReminder"),
    binding.emailTemplateVersion,
    {
      firstName: user.firstName,
      domain: domainName,
    },
  );

  try {
    await sendEmail({
      refreshToken,
      to: email,
      subject,
      html,
    });
  } catch (err) {
    console.error("Failed to send invite reminder:", err);
    return Response.json(
      { error: "Failed to send email — try again." },
      { status: 502 },
    );
  }

  await logAuditEvent({
    action: "interview.invite-reminder.sent",
    userId: auth.user.sub,
    targetId: domainApp.id,
    metadata: {
      domainApplicationId: domainApp.id,
      applicationCycleId: domainApp.application.applicationCycleId,
      to: email,
    },
    request,
  });

  return Response.json({ ok: true });
}
