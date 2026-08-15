import type { Route } from "./+types/api.decisions.$id.release";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { renderForSlot, decisionSlot } from "~/hiring/lib/email-variables";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { onboardingEmailHtml } from "~/members/lib/welcome.server";
import type { ProvisionResult } from "~/members/lib/provisioning.server";
import {
  internalCycleConfig,
  memberOnAccept,
  type AcceptContext,
} from "~/hiring/lib/internal-cycles.server";
import { notify } from "~/lib/notify.server";
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

  // Resolve the target Domain via the direct relation (always set).
  const targetDomain = domainApp.domain ?? null;
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

  // Internal cycles (Fellowship/Core) each pick how decisions reach the
  // applicant. Fellowship uses email (binding required); Core notifies in-app
  // (binding optional). Standard cycles are email-only.
  const config = internalCycleConfig(domainApp.application.applicationCycle.cycleType);
  const decisionChannel = config?.decisionChannel ?? "email";

  const binding = await prisma.cycleDecisionEmail.findUnique({
    where: {
      applicationCycleId_decisionType: {
        applicationCycleId: domainApp.application.applicationCycleId,
        decisionType: decision.type,
      },
    },
    include: { emailTemplateVersion: true },
  });
  if (!binding && decisionChannel === "email") {
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

  // ── Acceptance side-effect (per cycle type) ──────────────────────────────
  // Standard + Fellowship promote the applicant to a lab member (grant P1
  // eligibility in the target domain, provision the account, file the
  // onboarding todo). Core instead materializes CoreAssignment rows + notifies
  // admins. The handler comes from the internal-cycle registry; Standard (no
  // config) falls back to the member path. Idempotent: a re-release is a no-op.
  let acceptAuditMeta: Record<string, unknown> = {};
  let provisionResult: ProvisionResult | null = null;
  if (decision.type === "Accepted") {
    const onAccept = config ? config.onAccept : memberOnAccept;
    const u = domainApp.application.user;
    const ctx: AcceptContext = {
      userId: domainApp.application.userId,
      actorId: auth.user.sub,
      domainId: targetDomain.id,
      firstName: u?.firstName ?? "",
      candidateEmail: u?.dartmouthEmail ?? (u?.netId ? `${u.netId}@dartmouth.edu` : null),
    };
    const result = await onAccept(ctx);
    acceptAuditMeta = result.auditMeta;
    provisionResult = result.provision;

    // Single placement: an Accept is final, so the applicant's other domains
    // this cycle are moot. Close every still-undecided sibling DA (selected,
    // no Released decision of its own, not already closed) as "Accepted
    // elsewhere" so it stops reading as a stale "Pending". Rejected/Waitlisted
    // siblings keep their recorded outcome; idempotent on re-release.
    await prisma.domainApplication.updateMany({
      where: {
        applicationId: domainApp.applicationId,
        id: { not: domainApp.id },
        selected: true,
        closureReason: null,
        decisions: { none: { stage: "Released" } },
      },
      data: { closureReason: "AcceptedElsewhere", closedAt: new Date() },
    });
  }

  // ── Send notification email via per-cycle binding ────────────────────────────
  // Sent whenever a template is bound (always for email-channel cycles;
  // optional for in-app cycles like Core).
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

    if (binding && to && user) {
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

        // For member-producing acceptances (Standard/Fellowship), append the
        // onboarding block (account details + login link + logo) so the new
        // member gets a single email instead of a separate welcome message. The
        // temporary password is rendered ONLY into this email — never logged
        // (see the audit metadata below, which omits it). Core acceptances don't
        // provision an account, so there's no onboarding block.
        const onboarding = provisionResult
          ? onboardingEmailHtml(
              provisionResult.daliEmail ?? null,
              provisionResult.daliTempPassword ?? null,
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

  // ── In-app decision notification (in-app–channel cycles, e.g. Core) ──────────
  // Applicants are current members, so the released decision reaches them in
  // the app rather than by email. Best-effort.
  let inAppNotified = false;
  if (config?.decisionChannel === "inApp" && config.decisionNotificationEvent) {
    const accepted = decision.type === "Accepted";
    const message = accepted
      ? { title: "You've been added to Core", body: "Welcome to Core — your assignment is active for this cycle." }
      : decision.type === "Waitlisted"
        ? { title: "Core application update", body: "You've been placed on the Core waitlist." }
        : { title: "Core application update", body: "A decision on your Core application has been released." };
    try {
      await notify({
        eventType: config.decisionNotificationEvent,
        createdByUserId: auth.user.sub,
        message: { ...message, link: config.portalPath },
        recipients: [{ userId: domainApp.application.userId }],
      });
      inAppNotified = true;
    } catch (err) {
      console.error("[decision-release] in-app notify failed:", err);
    }
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
      inAppNotified,
      provisioning: provisioningForAudit,
      ...acceptAuditMeta,
    },
    request,
  });

  return Response.json(released, { status: 201 });
}
