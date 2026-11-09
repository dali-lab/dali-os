import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import type { NotificationCopyKey } from "~/email/lib/notification-copy";
import { renderEmail, escapeHtml, htmlToPlainText } from "~/lib/email";
import { sendEducationEmail } from "./portal-email.server";
import { renderFramedEmail } from "~/email/lib/layout.server";
import { getEducationEmail } from "~/education/lib/education-emails.server";
import { decisionSlot } from "~/education/lib/education-emails";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";
import { APPLICATION_TZ } from "~/lib/timezone";
import type { EduApplicationStatus } from "~/generated/prisma/client";

type Recipient = {
  id: string;
  firstName: string;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
  netId: string | null;
};

export function recipientEmail(user: Recipient): string | null {
  return (
    user.daliEmail ??
    user.dartmouthEmail ??
    user.personalEmail ??
    (user.netId ? `${user.netId}@dartmouth.edu` : null)
  );
}

/** Members get member-shell links; everyone else gets the portal mirror. */
export function educationLink(user: { daliEmail: string | null }, offeringId: string): string {
  return user.daliEmail
    ? `/education/${offeringId}`
    : `/portal/education/${offeringId}`;
}

// Which template writes each outcome. The words live in
// app/email/lib/notification-copy.ts so Core can edit them.
const STATUS_COPY_KEY: Record<
  Exclude<EduApplicationStatus, "Submitted">,
  NotificationCopyKey
> = {
  Approved: "education.decision.approved",
  Waitlisted: "education.decision.waitlisted",
  Rejected: "education.decision.rejected",
  Withdrawn: "education.decision.withdrawn",
};

/**
 * In-app notification + (when the status has an email written) email for
 * an application status change. Email is best-effort — failures are logged,
 * never thrown; the in-app Notification and the portal status page are the
 * fallback surfaces. `promoted` swaps in "a seat opened up" copy.
 */
export async function notifyApplicationStatus(
  applicationId: string,
  opts: { promoted?: boolean } = {},
): Promise<void> {
  const application = await prisma.educationApplication.findUnique({
    where: { id: applicationId },
    select: {
      status: true,
      applicant: {
        select: {
          id: true,
          firstName: true,
          daliEmail: true,
          dartmouthEmail: true,
          personalEmail: true,
          netId: true,
        },
      },
      offering: { select: { id: true, title: true } },
    },
  });
  if (!application || application.status === "Submitted") return;
  const { applicant, offering, status } = application;

  const copyKey = opts.promoted
    ? ("education.decision.promoted" as const)
    : STATUS_COPY_KEY[status];

  try {
    // education.decision is externalEmail in the registry: notify() never
    // emails it, so the template-bound sendDecisionEmail below can't double-send.
    await notify({
      eventType: "education.decision",
      message: {
        copyKey,
        vars: { itemTitle: offering.title },
        link: educationLink(applicant, offering.id),
      },
      recipients: [{ userId: applicant.id }],
    });
  } catch (err) {
    console.error("education notification write failed", {
      applicationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await sendDecisionEmail({
    applicationId,
    offeringId: offering.id,
    offeringTitle: offering.title,
    status,
    applicant,
    promoted: opts.promoted,
  });
}

/**
 * Tell every approved enrollee a new assignment exists, deep-linked to the
 * assignment on their surface. Best-effort.
 */
export async function notifyNewAssignment(args: {
  offeringId: string;
  assignmentId: string;
  assignmentTitle: string;
  dueAt: Date | null;
}): Promise<void> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: { id: true, title: true },
  });
  if (!offering) return;
  const enrollees = await prisma.educationApplication.findMany({
    where: { offeringId: args.offeringId, status: "Approved" },
    select: { applicant: { select: { id: true, daliEmail: true } } },
  });
  if (enrollees.length === 0) return;

  // Pinned to the lab zone: the server runs UTC on Fly, so an 11:59 PM ET
  // deadline would otherwise print the following day.
  const body = args.dueAt
    ? `Due ${args.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: APPLICATION_TZ })}. Open the course hub to submit.`
    : "Open the course hub to submit.";

  try {
    await notify({
      eventType: "education.assignment",
      message: {
        copyKey: "education.assignment",
        vars: { itemTitle: args.assignmentTitle, contextName: offering.title, itemDetail: body },
        linkLabel: "Open the assignment",
        dedupKey: `education.assignment:${args.assignmentId}`,
      },
      recipients: enrollees.map(({ applicant }) => ({
        userId: applicant.id,
        link: `${educationLink(applicant, offering.id)}/assignments/${args.assignmentId}`,
      })),
    });
  } catch (err) {
    console.error("assignment notification failed", {
      assignmentId: args.assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Tell a student their submission was graded. */
export async function notifyGraded(args: {
  studentId: string;
  offeringId: string;
  assignmentId: string;
  assignmentTitle: string;
}): Promise<void> {
  const student = await prisma.user.findUnique({
    where: { id: args.studentId },
    select: { id: true, daliEmail: true },
  });
  if (!student) return;
  try {
    await notify({
      eventType: "education.grade",
      message: { vars: { itemTitle: args.assignmentTitle }, linkLabel: "Open the assignment" },
      recipients: [
        {
          userId: student.id,
          link: `${educationLink(student, args.offeringId)}/assignments/${args.assignmentId}`,
        },
      ],
    });
  } catch (err) {
    console.error("grade notification failed", {
      assignmentId: args.assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Remind approved enrollees that a session is starting soon. Times are labeled
 * ET: the shared body can't be per-recipient, and the hub renders each user's
 * own zone.
 */
export async function notifySessionReminder(args: {
  sessionId: string;
  offeringId: string;
  offeringTitle: string;
  sequence: number;
  sessionTitle: string | null;
  datetime: Date;
  location: string | null;
}): Promise<void> {
  const enrollees = await prisma.educationApplication.findMany({
    where: { offeringId: args.offeringId, status: "Approved" },
    select: { applicant: { select: { id: true, daliEmail: true } } },
  });
  if (enrollees.length === 0) return;

  const label = args.sessionTitle ?? `Session ${args.sequence}`;
  const when = args.datetime.toLocaleString("en-US", {
    timeZone: APPLICATION_TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  try {
    await notify({
      eventType: "education.session_reminder",
      message: {
        vars: {
          itemTitle: label,
          contextName: args.offeringTitle,
          // A course session happens in a room in Hanover, so the lab zone is right.
          when: `${when} (ET)`,
          itemDetail: args.location ? ` · ${args.location}` : "",
        },
        linkLabel: "Open the course hub",
        dedupKey: `education.session_reminder:${args.sessionId}`,
      },
      recipients: enrollees.map(({ applicant }) => ({
        userId: applicant.id,
        link: `${educationLink(applicant, args.offeringId)}/hub`,
      })),
    });
  } catch (err) {
    console.error("session reminder notification failed", {
      offeringId: args.offeringId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send the shared decision email for this status. One email per slot, shared
 * by every course; a slot with no email sends nothing (the in-app
 * notification above still fires). Best-effort by contract: dev skips sends,
 * staging redirects, and any failure only logs.
 */
async function sendDecisionEmail(args: {
  applicationId: string;
  offeringId: string;
  offeringTitle: string;
  status: Exclude<EduApplicationStatus, "Submitted">;
  applicant: Recipient;
  promoted?: boolean;
}): Promise<void> {
  try {
    // A promotion is an Approved decision reached a different way, so it gets its
    // own copy when an operator has written some and the Approved letter when they
    // haven't — which is what shipped before this key existed.
    const email =
      (args.promoted ? await getEducationEmail("decision:Promoted") : null) ??
      (await getEducationEmail(decisionSlot(args.status)));
    if (!email) return;

    const to = recipientEmail(args.applicant);
    if (!to) return;

    const { subject, html } = renderEmail(
      email,
      // {{domain}} carries the course title in education emails.
      { firstName: args.applicant.firstName, domain: args.offeringTitle },
    );
    // Operator-authored copy, so the frame adds no greeting or CTA of its own —
    // whatever the template says is the whole message.
    const mail = await renderFramedEmail(
      {
        subject,
        bodyHtml: html,
        text: htmlToPlainText(html),
        preheader: subject,
      },
      { footer: "transactional" },
    );

    const userRef = args.applicant.id.toLowerCase();
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: "Education",
      // The outcome is part of the key. Without it the key was
      // `education.decision:{applicationId}:{userRef}`, so a student who was
      // Waitlisted and later Approved hit the claim their waitlist email had
      // already made and got NO second email at all — the promotion was silently
      // dropped rather than merely worded wrong. Re-deciding to the same outcome
      // still dedupes, which is the case the key is actually there to guard.
      dedupKey: `education.decision:${args.applicationId}:${args.promoted ? "promoted" : args.status}:${userRef}`,
      target: to,
      recipientUserId: args.applicant.id,
      subject: mail.subject,
      bodyHtml: mail.html,
      bodyText: mail.text,
      eventType: "education.decision",
    });
    await drainNow([id]);
  } catch (err) {
    console.error("education decision email failed", {
      offeringId: args.offeringId,
      status: args.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Email a newly-invited external (non-DALI) instructor. They authenticate with
 * Dartmouth SSO; the link deep-links into the management surface and login-next
 * returns them there after CAS. Transactional (outside the notification
 * preference layer), like the other applicant/portal education email.
 */
export async function notifyExternalInstructorInvite(args: {
  user: { id: string; firstName: string; dartmouthEmail: string | null; netId: string | null };
  offeringId: string;
  offeringTitle: string;
}): Promise<void> {
  const target =
    args.user.dartmouthEmail ??
    (args.user.netId ? `${args.user.netId}@dartmouth.edu` : null);
  if (!target) return;
  try {
    await sendEducationEmail({
      to: target,
      recipientUserId: args.user.id,
      dedupKey: `education.instructor-invite:${args.offeringId}:${args.user.id.toLowerCase()}`,
      eventType: "education.instructor-invite",
      subject: `You're an instructor for ${args.offeringTitle}`,
      firstName: args.user.firstName,
      paragraphs: [
        `You've been added as an instructor for ${args.offeringTitle} in DALI OS. You can manage sessions, review applications, take attendance, and grade work.`,
        "Sign in with Dartmouth to get started.",
      ],
      cta: {
        path: `/education/manage/${args.offeringId}`,
        label: "Open your teaching dashboard",
      },
    });
  } catch (err) {
    console.error("external instructor invite email failed", {
      offeringId: args.offeringId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
