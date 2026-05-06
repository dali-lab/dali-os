import type { Route } from "./+types/api.decisions.$id.release";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { renderForSlot, decisionSlot } from "~/hiring/lib/email-variables";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const GMAIL_USER = "applications@dali.dartmouth.edu";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  if (!(await isHiringLead(auth.user.sub))) {
    return withAuth(auth, Response.json(
          { error: "Only hiring leads can release decisions" },
          { status: 403 }
        ));
  }

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return withAuth(auth, Response.json({ error: "Not a DALI member" }, { status: 403 }));
  }

  const decision = await prisma.decision.findUnique({
    where: { id: params.id },
  });
  if (!decision) {
    return withAuth(auth, Response.json({ error: "Decision not found" }, { status: 404 }));
  }
  if (decision.stage !== "Final") {
    return withAuth(auth, Response.json(
          { error: "Only Final decisions can be released" },
          { status: 409 }
        ));
  }

  const domainApp = await prisma.domainApplication.findUnique({
    where: { id: decision.domainApplicationId },
    include: {
      challengeVersion: {
        include: { domain: { select: { name: true } } },
      },
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
    },
  });
  if (!domainApp) {
    return withAuth(auth, Response.json(
          { error: "Domain application not found" },
          { status: 404 }
        ));
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    domainApp.application.applicationCycleId,
  );
  if (gate) return withAuth(auth, gate);

  const binding = await prisma.cycleDecisionEmail.findUnique({
    where: {
      applicationCycleId_decisionType: {
        applicationCycleId: domainApp.application.applicationCycleId,
        decisionType: decision.type,
      },
    },
    include: { emailTemplateVersion: true },
  });
  if (!binding) {
    return withAuth(auth, Response.json(
          {
            error: `No email template is bound to ${decision.type} in this cycle. Bind one on the Setup tab before releasing.`,
          },
          { status: 409 }
        ));
  }

  const released = await prisma.decision.create({
    data: {
      domainApplicationId: decision.domainApplicationId,
      type: decision.type,
      stage: "Released",
      madeById: member.id,
      notes: decision.notes,
      waitlistRank: decision.waitlistRank,
      parentDecisionId: decision.id,
    },
  });

  // ── Send notification email via per-cycle binding ────────────────────────────
  let emailSent = false;
  try {
    const user = domainApp.application.user;
    const email =
      user?.dartmouthEmail ??
      (user?.netId ? `${user.netId}@dartmouth.edu` : null);
    const domainName = domainApp.challengeVersion.domain?.name ?? "";

    if (email && user) {
      const gmailUser = await prisma.user.findUnique({
        where: { daliEmail: GMAIL_USER },
        select: { googleRefreshToken: true },
      });

      if (gmailUser?.googleRefreshToken) {
        const { subject, html } = renderForSlot(
          decisionSlot(decision.type),
          binding.emailTemplateVersion,
          {
            firstName: user.firstName,
            domain: domainName,
          },
        );

        await sendEmail({
          refreshToken: gmailUser.googleRefreshToken,
          to: email,
          subject,
          html,
        });
        emailSent = true;
      }
    }
  } catch (err) {
    // Log but don't fail the release if email sending fails.
    console.error("Failed to send release email:", err);
  }

  await logAuditEvent({
    action: "decision.release",
    userId: auth.user.sub,
    targetId: released.id,
    metadata: {
      decisionId: released.id,
      parentDecisionId: decision.id,
      domainApplicationId: decision.domainApplicationId,
      type: released.type,
      emailSent,
    },
    request,
  });

  return withAuth(auth, Response.json(released, { status: 201 }));
}
