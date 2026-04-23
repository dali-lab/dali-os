import type { Route } from "./+types/api.decisions.$id.release";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { sendEmail } from "~/lib/gmail";
import type { DecisionType, EmailTemplateType } from "~/generated/prisma/enums";

const GMAIL_USER = "applications@dali.dartmouth.edu";

/** Map a DecisionType to the corresponding EmailTemplateType. */
function templateTypeForDecision(type: DecisionType): EmailTemplateType {
  switch (type) {
    case "Rejected":
      return "Rejected";
    case "InvitedToInterview":
      return "InvitedToInterview";
    case "Accepted":
      return "Accepted";
    case "Waitlisted":
      return "Waitlisted";
  }
}

function interpolate(text: string, firstName: string): string {
  return text.replace(/\{\{firstName\}\}/g, firstName);
}

function bodyToHtml(body: string): string {
  return body
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

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
    },
  });

  // ── Send notification email via template lookup ───────────────────────────
  try {
    // Look up applicant info through the relation chain
    const domainApp = await prisma.domainApplication.findUnique({
      where: { id: decision.domainApplicationId },
      include: {
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

    if (email && user) {
      // Look up the current template for this decision type
      const templateType = templateTypeForDecision(decision.type);
      const template = await prisma.emailTemplate.findFirst({
        where: { type: templateType },
        orderBy: { createdAt: "desc" },
      });

      if (template) {
        // Get the Gmail refresh token
        const gmailUser = await prisma.user.findUnique({
          where: { daliEmail: GMAIL_USER },
          select: { googleRefreshToken: true },
        });

        if (gmailUser?.googleRefreshToken) {
          const subject = interpolate(template.subject, user.firstName);
          const html = bodyToHtml(
            interpolate(template.body, user.firstName)
          );

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
    // Log but don't fail the release if email sending fails
    console.error("Failed to send release email:", err);
  }

  return Response.json(released, { status: 201 });
}
