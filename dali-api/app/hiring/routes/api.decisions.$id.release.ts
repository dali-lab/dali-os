import type { Route } from "./+types/api.decisions.$id.release";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { renderForSlot, decisionSlot } from "~/hiring/lib/email-variables";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { promoteToMember } from "~/members/lib/membership.server";
import { sendWelcome, onboardingEmailHtml } from "~/members/lib/welcome.server";
import { provisionNewMember, type ProvisionResult } from "~/members/lib/provisioning.server";
import { resolveCandidateEmail, redirectBannerHtml } from "~/lib/candidate-email";

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

  // ── Acceptance side-effect: promote to member + grant eligibility ─────────
  // When ANY applicant is accepted (Standard or Fellowship), make them a lab
  // member and grant DomainEligibility in the target domain at P1 so staffing
  // flows pick them up. Previously only Fellowship granted eligibility and
  // nobody was auto-promoted to a member. Idempotent: promoteToMember upserts
  // the DALIMember row and eligibility, so a re-release changes nothing. A
  // brand-new member's onboardedAt stays null → the layout gate routes them
  // through /onboarding on first login.
  let memberPromoted = false;
  let welcomeNotified = false;
  let provisionResult: ProvisionResult | null = null;
  if (decision.type === "Accepted") {
    const { created } = await promoteToMember({
      userId: domainApp.application.userId,
      domainId: targetDomain.id,
      level: "P1",
      actorId: auth.user.sub,
    });
    memberPromoted = created;

    // Provision FIRST — this creates the @dali.dartmouth.edu account and the
    // Slack invite. The welcome email then references the new DALI email.
    // Best-effort: each step is isolated; failures are recorded, not thrown.
    try {
      provisionResult = await provisionNewMember({
        userId: domainApp.application.userId,
        domainId: targetDomain.id,
      });
    } catch (err) {
      console.error("Failed to provision new member:", err);
    }

    // Welcome the new member with a persistent "finish onboarding" todo. The
    // welcome *email* is folded into the Accepted decision email below (single
    // email per acceptance), so this no longer sends mail. Best-effort.
    try {
      const u = domainApp.application.user;
      const welcomeEmail =
        u?.dartmouthEmail ?? (u?.netId ? `${u.netId}@dartmouth.edu` : null);
      const { notified } = await sendWelcome({
        userId: domainApp.application.userId,
        actorId: auth.user.sub,
        firstName: u?.firstName ?? "",
        email: welcomeEmail,
        daliEmail: provisionResult?.daliEmail ?? null,
      });
      welcomeNotified = notified;
    } catch (err) {
      console.error("Failed to send welcome:", err);
    }
  }

  // ── Send notification email via per-cycle binding ────────────────────────────
  let emailSent = false;
  try {
    const user = domainApp.application.user;
    const intendedEmail =
      user?.dartmouthEmail ??
      (user?.netId ? `${user.netId}@dartmouth.edu` : null);
    const domainName = targetDomain.displayName ?? targetDomain.name ?? "";

    // dev/staging: redirect to the test inbox with a banner naming the real
    // candidate; prod: send to the candidate.
    const { to, redirectedFrom } = resolveCandidateEmail(intendedEmail);

    if (to && user) {
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

        // For acceptances, append the onboarding block (account details + login
        // link + logo) so the new member gets a single email instead of a
        // separate welcome message. The temporary password is rendered ONLY into
        // this email — never logged (see the audit metadata below, which omits
        // it).
        const onboarding =
          decision.type === "Accepted"
            ? onboardingEmailHtml(
                provisionResult?.daliEmail ?? null,
                provisionResult?.daliTempPassword ?? null,
              )
            : "";

        await sendEmail({
          refreshToken,
          to,
          subject,
          html: redirectBannerHtml(redirectedFrom) + html + onboarding,
        });
        emailSent = true;
      }
    }
  } catch (err) {
    // Log but don't fail the release if email sending fails.
    console.error("Failed to send release email:", err);
  }

  // Strip the one-time temp password before it reaches the audit log — it's a
  // live credential and must never be persisted in logs (see CLAUDE.md).
  const provisioningForAudit = provisionResult
    ? (() => {
        const { daliTempPassword: _omit, ...rest } = provisionResult;
        return rest;
      })()
    : null;

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
      memberPromoted,
      welcomeNotified,
      provisioning: provisioningForAudit,
    },
    request,
  });

  return Response.json(released, { status: 201 });
}
