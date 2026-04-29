import type { Route } from "./+types/api.decisions.$id.release";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import { renderEmail } from "~/lib/email";

const GMAIL_USER = "applications@dali.dartmouth.edu";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!(await isHiringLead(auth.user.sub))) {
    return Response.json(
      { error: "Only hiring leads can release decisions" },
      { status: 403 }
    );
  }

  const member = await prisma.dALIMember.findFirst({
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
  try {
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

    const user = domainApp?.application.user;
    const email =
      user?.dartmouthEmail ??
      (user?.netId ? `${user.netId}@dartmouth.edu` : null);
    const domainName = domainApp?.challengeVersion.domain?.name ?? "";

    if (email && user && domainApp) {
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
        console.warn(
          `No email template bound for cycle ${domainApp.application.applicationCycleId} / decision ${decision.type}; skipping send.`
        );
      } else {
        const gmailUser = await prisma.user.findUnique({
          where: { daliEmail: GMAIL_USER },
          select: { googleRefreshToken: true },
        });

        if (gmailUser?.googleRefreshToken) {
          const { subject, html } = renderEmail(binding.emailTemplateVersion, {
            firstName: user.firstName,
            domain: domainName,
          });

          await sendEmail({
            refreshToken: gmailUser.googleRefreshToken,
            to: email,
            subject,
            html,
          });
        }
      }
    }
  } catch (err) {
    // Log but don't fail the release if email sending fails.
    console.error("Failed to send release email:", err);
  }

  return Response.json(released, { status: 201 });
}
