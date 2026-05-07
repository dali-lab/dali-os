import type { Route } from "./+types/api.my-application";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { sendEmail } from "~/lib/gmail";
import { renderForSlot, notificationSlot } from "~/hiring/lib/email-variables";
import { parseJson } from "~/lib/validate";

const GMAIL_USER = "applications@dali.dartmouth.edu";

const MAX_ANSWER_KEYS = 100;
const MAX_ANSWER_KEY_LENGTH = 200;
const MAX_ANSWER_VALUE_LENGTH = 50_000;

const ApplicationSchema = z.object({
  answers: z
    .record(
      z.string().max(MAX_ANSWER_KEY_LENGTH),
      z.string().max(MAX_ANSWER_VALUE_LENGTH),
    )
    .refine((v) => Object.keys(v).length <= MAX_ANSWER_KEYS, {
      message: `answers may have at most ${MAX_ANSWER_KEYS} keys`,
    })
    .optional(),
});

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
    return withAuth(auth, withCors(request, Response.json({ application: null, interview: null, cycleStatus: null })));
  }

  const cycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";

  if (!application) {
    return withAuth(auth, withCors(request, Response.json({
          application: null,
          interview: null,
          cycleStatus,
          cycleId: cycle.id,
        })));
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

  return withAuth(auth, withCors(request, Response.json({
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
    })));
}

// POST /api/hiring/my-application
// Body: { answers: Record<string, string>, domainAnswers?: Record<string, Record<string, string>> }
// Creates or updates the application and marks it as Submitted, then sends a confirmation email.
export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const userId = auth.user.sub;

  const body = await parseJson(request, ApplicationSchema);
  if (body instanceof Response) return withAuth(auth, withCors(request, body));

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
    return withAuth(auth, withCors(request, Response.json({ error: "No active application cycle" }, { status: 400 })));
  }

  const cycleStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
  if (cycleStatus !== "Open") {
    return withAuth(auth, withCors(request, Response.json({ error: "Applications are not open" }, { status: 400 })));
  }

  // Withdrawn is sticky: bail before the upsert so we never resurrect a
  // withdrawn application with new answers.
  const existingForWithdrawnCheck = await prisma.application.findUnique({
    where: { userId_applicationCycleId: { userId, applicationCycleId: cycle.id } },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (existingForWithdrawnCheck?.statusUpdates[0]?.newStatus === "Withdrawn") {
    return withAuth(auth, withCors(
          request,
          Response.json({ error: "Application has been withdrawn" }, { status: 409 }),
        ));
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
    return withAuth(auth, withCors(request, Response.json({ ok: true })));
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
        const binding = await prisma.cycleNotificationEmail.findUnique({
          where: {
            applicationCycleId_notificationType: {
              applicationCycleId: cycle.id,
              notificationType: "ApplicationReceived",
            },
          },
          include: { emailTemplateVersion: true },
        });
        if (binding) {
          // ApplicationReceived isn't tied to a single domain (an applicant
          // may apply to multiple), so {{domain}} is intentionally not passed
          // here — the registry reflects this and the editor warns leads who
          // try to use {{domain}} in this slot.
          const { subject, html } = renderForSlot(
            notificationSlot("ApplicationReceived"),
            binding.emailTemplateVersion,
            { firstName: user.firstName },
          );
          await sendEmail({ refreshToken: gmailUser.googleRefreshToken, to, subject, html });
        }
      }
    }
  } catch (err) {
    console.error("Failed to send application confirmation email:", err);
  }

  return withAuth(auth, withCors(request, Response.json({ ok: true })));
}
