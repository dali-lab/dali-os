import type { Route } from "./+types/api.my-application";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { sendEmail } from "~/lib/gmail";
import { interpolate, bodyToHtml } from "~/lib/email";

const GMAIL_USER = "applications@dali.dartmouth.edu";

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  // Prefer the user's most recent application — its cycle is the one they care
  // about. Falling back to the latest cycle (when no application exists) lets
  // applicants who haven't yet applied see the open cycle so they can start.
  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domainApplications: {
        include: { challengeVersion: { select: { domainId: true } } },
      },
      applicationCycle: {
        include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let cycle = application?.applicationCycle ?? null;
  if (!cycle) {
    cycle = await prisma.applicationCycle.findFirst({
      orderBy: { createdAt: "desc" },
      include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
  }

  if (!cycle) {
    return withCors(request, Response.json({ application: null, interview: null, cycleStatus: null }));
  }

  const cycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";

  if (!application) {
    return withCors(request, Response.json({
      application: null,
      interview: null,
      cycleStatus,
      cycleId: cycle.id,
    }));
  }

  const appStatus = application.statusUpdates[0]?.newStatus ?? "Draft";
  const domainIds = application.domainApplications.map(
    (da) => da.challengeVersion.domainId,
  );

  // Find active interview for this application
  const interview = await prisma.interview.findFirst({
    where: {
      domainApplication: { applicationId: application.id },
      status: "Scheduled",
    },
    orderBy: { createdAt: "desc" },
  });

  return withCors(request, Response.json({
    application: {
      id: application.id,
      applicationCycleId: application.applicationCycleId,
      status: appStatus,
      domainIds,
    },
    interview: interview
      ? { id: interview.id, startTime: interview.startTime, endTime: interview.endTime, status: interview.status }
      : null,
    cycleStatus,
    cycleId: cycle.id,
  }));
}

// POST /api/my-application
// Body: { answers: Record<string, string>, domainAnswers?: Record<string, Record<string, string>> }
// Creates or updates the application and marks it as Submitted, then sends a confirmation email.
export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const userId = auth.user.sub;

  let body: { answers?: Record<string, string> } = {};
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const answers = body.answers ?? {};

  // Get the latest cycle and its form version
  const cycle = await prisma.applicationCycle.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      formVersion: true,
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!cycle || !cycle.formVersion) {
    return withCors(request, Response.json({ error: "No active application cycle" }, { status: 400 }));
  }

  const cycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
  if (cycleStatus !== "Open") {
    return withCors(request, Response.json({ error: "Applications are not open" }, { status: 400 }));
  }

  // Check for existing application
  const existing = await prisma.application.findFirst({
    where: { userId, applicationCycleId: cycle.id },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (existing) {
    const alreadySubmitted = existing.statusUpdates[0]?.newStatus === "Submitted";
    // Update answers; only create a new status update on first submission
    await prisma.application.update({
      where: { id: existing.id },
      data: {
        answers,
        ...(alreadySubmitted ? {} : {
          statusUpdates: { create: { newStatus: "Submitted", userId } },
        }),
      },
    });
    // Only send confirmation email on first submission
    if (alreadySubmitted) {
      return withCors(request, Response.json({ ok: true }));
    }
  } else {
    // Create new application as Submitted
    await prisma.application.create({
      data: {
        userId,
        applicationCycleId: cycle.id,
        applicationFormVersionId: cycle.formVersion.id,
        answers,
        statusUpdates: { create: { newStatus: "Submitted", userId } },
      },
    });
  }

  // Send confirmation email (best-effort — don't fail the submission if email fails)
  try {
    const gmailUser = await prisma.user.findUnique({
      where: { daliEmail: GMAIL_USER },
      select: { googleRefreshToken: true },
    });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (gmailUser?.googleRefreshToken && user) {
      const to = user.dartmouthEmail ?? user.daliEmail ?? "";
      if (to) {
        // ApplicationReceived still uses the legacy global-by-type lookup —
        // out of scope for the rubric-pattern refactor (decision emails only).
        const template = await prisma.legacyEmailTemplate.findFirst({
          where: { type: "ApplicationReceived" },
          orderBy: { createdAt: "desc" },
        });
        if (template) {
          const subject = interpolate(template.subject, user.firstName);
          const html = bodyToHtml(interpolate(template.body, user.firstName));
          await sendEmail({ refreshToken: gmailUser.googleRefreshToken, to, subject, html });
        }
      }
    }
  } catch (err) {
    console.error("Failed to send application confirmation email:", err);
  }

  return withCors(request, Response.json({ ok: true }));
}
