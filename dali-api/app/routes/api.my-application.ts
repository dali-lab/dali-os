import type { Route } from "./+types/api.my-application";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { sendEmail } from "~/lib/gmail";
import { renderEmail } from "~/lib/email";

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

  // Get the latest cycle and its general challenge version (the form). The
  // general form is the ChallengeVersion linked to the cycle with domainId: null.
  const cycle = await prisma.applicationCycle.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      challengeVersions: { include: { challengeVersion: true } },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const generalCvac = cycle?.challengeVersions.find(
    (cvc) => cvc.challengeVersion.domainId === null,
  );

  if (!cycle || !generalCvac) {
    return withCors(request, Response.json({ error: "No active application cycle" }, { status: 400 }));
  }

  const cycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
  if (cycleStatus !== "Open") {
    return withCors(request, Response.json({ error: "Applications are not open" }, { status: 400 }));
  }

  // Withdrawn is sticky: bail before the upsert so we never resurrect a
  // withdrawn application with new answers.
  const existingForWithdrawnCheck = await prisma.application.findUnique({
    where: { userId_applicationCycleId: { userId, applicationCycleId: cycle.id } },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (existingForWithdrawnCheck?.statusUpdates[0]?.newStatus === "Withdrawn") {
    return withCors(
      request,
      Response.json({ error: "Application has been withdrawn" }, { status: 409 }),
    );
  }

  // Atomic upsert keyed on the (userId, applicationCycleId) unique constraint.
  // Combined with a status-update insert in the same transaction so concurrent
  // POSTs converge on a single Application row and at most one Submitted
  // status-update fires the confirmation email path.
  const { firstSubmission } = await prisma.$transaction(async (tx) => {
    const app = await tx.application.upsert({
      where: { userId_applicationCycleId: { userId, applicationCycleId: cycle.id } },
      update: { answers },
      create: {
        userId,
        applicationCycleId: cycle.id,
        generalChallengeVersionId: generalCvac.challengeVersionId,
        answers,
      },
    });
    const latestStatus = await tx.applicationStatusUpdate.findFirst({
      where: { applicationId: app.id },
      orderBy: { createdAt: "desc" },
    });
    if (latestStatus?.newStatus === "Submitted") {
      return { firstSubmission: false };
    }
    await tx.applicationStatusUpdate.create({
      data: { newStatus: "Submitted", applicationId: app.id, userId },
    });
    return { firstSubmission: true };
  });

  // Only send confirmation email on first submission
  if (!firstSubmission) {
    return withCors(request, Response.json({ ok: true }));
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
          // ApplicationReceived isn't tied to a single domain (an applicant
          // may apply to multiple), so {{domain}} resolves to empty here.
          const { subject, html } = renderEmail(template, { firstName: user.firstName });
          await sendEmail({ refreshToken: gmailUser.googleRefreshToken, to, subject, html });
        }
      }
    }
  } catch (err) {
    console.error("Failed to send application confirmation email:", err);
  }

  return withCors(request, Response.json({ ok: true }));
}
