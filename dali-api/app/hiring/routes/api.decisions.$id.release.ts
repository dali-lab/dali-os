import type { Route } from "./+types/api.decisions.$id.release";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { renderForSlot, decisionSlot } from "~/hiring/lib/email-variables";
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
          { error: "Only hiring leads can release decisions" },
          { status: 403 }
        );
  }

  const member = await prisma.dALIMember.findUnique({
    where: { userId: auth.user.sub },
  });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  const decision = await prisma.decision.findUnique({
    where: { id: params.id },
  });
  if (!decision) {
    return Response.json({ error: "Decision not found" }, { status: 404 });
  }
  if (decision.stage !== "Final") {
    return Response.json(
          { error: "Only Final decisions can be released" },
          { status: 409 }
        );
  }

  const domainApp = await prisma.domainApplication.findUnique({
    where: { id: decision.domainApplicationId },
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
          applicationCycle: { select: { cycleType: true } },
        },
      },
    },
  });
  if (!domainApp) {
    return Response.json(
          { error: "Domain application not found" },
          { status: 404 }
        );
  }

  // Resolve the target Domain regardless of how it was linked.
  const targetDomain =
    domainApp.domain ?? domainApp.challengeVersion?.domain ?? null;
  if (!targetDomain) {
    return Response.json(
      { error: "Domain application has no linked domain — cannot release." },
      { status: 409 },
    );
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    domainApp.application.applicationCycleId,
  );
  if (gate) return gate;

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
    return Response.json(
          {
            error: `No email template is bound to ${decision.type} in this cycle. Bind one on the Setup tab before releasing.`,
          },
          { status: 409 }
        );
  }

  const released = await prisma.decision.create({
    data: {
      domainApplicationId: decision.domainApplicationId,
      type: decision.type,
      stage: "Released",
      madeById: auth.user.sub,
      notes: decision.notes,
      waitlistRank: decision.waitlistRank,
      parentDecisionId: decision.id,
    },
  });

  // ── InternToFull conversion side-effect ──────────────────────────────────
  // When an InternToFull applicant is accepted, grant them DomainEligibility
  // in the target domain at P1 so subsequent staffing flows pick them up.
  // Their intern DomainEligibility is left intact; it naturally lapses when
  // their intern term ends. Idempotent: upserts on the (userId, domainId)
  // unique constraint so a re-release doesn't change anything.
  let internConversionApplied = false;
  if (
    decision.type === "Accepted" &&
    domainApp.application.applicationCycle.cycleType === "InternToFull"
  ) {
    await prisma.domainEligibility.upsert({
      where: {
        userId_domainId: {
          userId: domainApp.application.userId,
          domainId: targetDomain.id,
        },
      },
      update: {},
      create: {
        userId: domainApp.application.userId,
        domainId: targetDomain.id,
        level: "P1",
        promotedBy: auth.user.sub,
      },
    });
    internConversionApplied = true;
  }

  // ── Send notification email via per-cycle binding ────────────────────────────
  let emailSent = false;
  try {
    const user = domainApp.application.user;
    const email =
      user?.dartmouthEmail ??
      (user?.netId ? `${user.netId}@dartmouth.edu` : null);
    const domainName = targetDomain.displayName ?? targetDomain.name ?? "";

    if (email && user) {
      const refreshToken = await getApplicationsGmailRefreshToken();

      if (refreshToken) {
        const { subject, html } = renderForSlot(
          decisionSlot(decision.type),
          binding.emailTemplateVersion,
          {
            firstName: user.firstName,
            domain: domainName,
          },
        );

        await sendEmail({
          refreshToken,
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
      internConversionApplied,
    },
    request,
  });

  return Response.json(released, { status: 201 });
}
