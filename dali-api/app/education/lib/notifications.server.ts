import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { renderEmail } from "~/lib/email";
import { sendEmail } from "~/lib/gmail";
import { getSenderRefreshToken } from "~/lib/gmail-integration";
import {
  resolveCandidateEmail,
  redirectBannerHtml,
} from "~/lib/candidate-email";
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

const STATUS_COPY: Record<
  Exclude<EduApplicationStatus, "Submitted">,
  { title: (offering: string) => string; body: (offering: string) => string }
> = {
  Approved: {
    title: (o) => `You're in: ${o}`,
    body: (o) => `Your spot in ${o} is confirmed. Open the course hub for sessions and materials.`,
  },
  Waitlisted: {
    title: (o) => `Waitlisted for ${o}`,
    body: (o) => `${o} is currently full. You're on the waitlist — if a seat opens you'll be enrolled automatically.`,
  },
  Rejected: {
    title: (o) => `Update on ${o}`,
    body: (o) => `Your application to ${o} wasn't accepted this time. We'd love to see you at a future offering.`,
  },
  Withdrawn: {
    title: (o) => `Withdrawn from ${o}`,
    body: (o) => `You've been withdrawn from ${o}.`,
  },
};

/**
 * In-app notification + (when a template is bound for this status) email for
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

  const copy = STATUS_COPY[status];
  const title = opts.promoted
    ? `A seat opened up: you're in ${offering.title}`
    : copy.title(offering.title);
  const body = opts.promoted
    ? `You've been moved off the waitlist and enrolled in ${offering.title}.`
    : copy.body(offering.title);

  try {
    // education.decision is externalEmail in the registry: notify() never
    // emails it, so the template-bound sendDecisionEmail below can't double-send.
    await notify({
      eventType: "education.decision",
      message: {
        title,
        body,
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
    offeringId: offering.id,
    offeringTitle: offering.title,
    status,
    applicant,
    fallback: { subject: title, body },
  });
}

/**
 * Tell every approved enrollee a new assignment exists, deep-linked to the
 * assignment on their surface. Members get an in-app Notification; portal
 * students (no bell) get the link by email. Best-effort per recipient.
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
    select: {
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
    },
  });
  if (enrollees.length === 0) return;

  const title = `New assignment in ${offering.title}: ${args.assignmentTitle}`;
  const body = args.dueAt
    ? `Due ${args.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Open the course hub to submit.`
    : "Open the course hub to submit.";

  // Members get a pref-aware in-app notification (education.assignment
  // defaults email Off — matching the old in-app-only behavior); portal
  // students have no bell, so they keep the direct email path unchanged.
  const members = enrollees.filter((e) => e.applicant.daliEmail);
  const portalStudents = enrollees.filter((e) => !e.applicant.daliEmail);

  if (members.length > 0) {
    try {
      await notify({
        eventType: "education.assignment",
        message: { title, body },
        recipients: members.map(({ applicant }) => ({
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

  for (const { applicant } of portalStudents) {
    const link = `${educationLink(applicant, offering.id)}/assignments/${args.assignmentId}`;
    try {
      const refreshToken = await getSenderRefreshToken("Education");
      if (!refreshToken) continue;
      const { to, redirectedFrom } = resolveCandidateEmail(recipientEmail(applicant));
      if (!to) continue;
      await sendEmail({
        refreshToken,
        to,
        subject: title,
        html:
          redirectBannerHtml(redirectedFrom) +
          `<p>Hi ${applicant.firstName},</p><p>${body}</p><p><a href="${getFrontendUrl()}${link}">Open the assignment</a></p>`,
      });
    } catch (err) {
      console.error("assignment notification failed", {
        assignmentId: args.assignmentId,
        userId: applicant.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Tell a student their submission was graded. Member in-app / portal email. */
export async function notifyGraded(args: {
  studentId: string;
  offeringId: string;
  assignmentId: string;
  assignmentTitle: string;
}): Promise<void> {
  const student = await prisma.user.findUnique({
    where: { id: args.studentId },
    select: {
      id: true,
      firstName: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      netId: true,
    },
  });
  if (!student) return;
  const title = `Feedback on ${args.assignmentTitle}`;
  const body = "Your instructor graded your submission — open the assignment to see it.";
  const link = `${educationLink(student, args.offeringId)}/assignments/${args.assignmentId}`;
  try {
    if (student.daliEmail) {
      await notify({
        eventType: "education.grade",
        message: { title, body },
        recipients: [{ userId: student.id, link }],
      });
    } else {
      const refreshToken = await getSenderRefreshToken("Education");
      if (!refreshToken) return;
      const { to, redirectedFrom } = resolveCandidateEmail(recipientEmail(student));
      if (!to) return;
      await sendEmail({
        refreshToken,
        to,
        subject: title,
        html:
          redirectBannerHtml(redirectedFrom) +
          `<p>Hi ${student.firstName},</p><p>${body}</p><p><a href="${getFrontendUrl()}${link}">Open the assignment</a></p>`,
      });
    }
  } catch (err) {
    console.error("grade notification failed", {
      assignmentId: args.assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Remind approved enrollees that a session is starting soon. Members get a
 * pref-aware in-app notification (education.session_reminder); portal students,
 * who have no bell, get a direct email. Times are labeled ET — the shared
 * in-app body can't be per-recipient, and the hub renders each user's own zone.
 */
export async function notifySessionReminder(args: {
  offeringId: string;
  offeringTitle: string;
  sequence: number;
  sessionTitle: string | null;
  datetime: Date;
  location: string | null;
}): Promise<void> {
  const enrollees = await prisma.educationApplication.findMany({
    where: { offeringId: args.offeringId, status: "Approved" },
    select: {
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
    },
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
  const title = `Upcoming: ${label}`;
  const body = `${args.offeringTitle} · ${when} (ET)${args.location ? ` · ${args.location}` : ""}`;

  const members = enrollees.filter((e) => e.applicant.daliEmail);
  const portalStudents = enrollees.filter((e) => !e.applicant.daliEmail);

  if (members.length > 0) {
    try {
      await notify({
        eventType: "education.session_reminder",
        message: { title, body },
        recipients: members.map(({ applicant }) => ({
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

  for (const { applicant } of portalStudents) {
    const link = `${educationLink(applicant, args.offeringId)}/hub`;
    try {
      const refreshToken = await getSenderRefreshToken("Education");
      if (!refreshToken) continue;
      const { to, redirectedFrom } = resolveCandidateEmail(recipientEmail(applicant));
      if (!to) continue;
      await sendEmail({
        refreshToken,
        to,
        subject: title,
        html:
          redirectBannerHtml(redirectedFrom) +
          `<p>Hi ${applicant.firstName},</p><p>${body}</p><p><a href="${getFrontendUrl()}${link}">Open the course hub</a></p>`,
      });
    } catch (err) {
      console.error("session reminder email failed", {
        offeringId: args.offeringId,
        userId: applicant.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Send the bound decision-email template for (offering, status), falling back
 * to the inline copy when no binding exists. Best-effort by contract: dev
 * skips sends, staging redirects, and any failure only logs.
 */
async function sendDecisionEmail(args: {
  offeringId: string;
  offeringTitle: string;
  status: Exclude<EduApplicationStatus, "Submitted">;
  applicant: Recipient;
  fallback: { subject: string; body: string };
}): Promise<void> {
  try {
    const refreshToken = await getSenderRefreshToken("Education");
    if (!refreshToken) return;

    const intended = recipientEmail(args.applicant);
    const { to, redirectedFrom } = resolveCandidateEmail(intended);
    if (!to) return;

    const binding = await prisma.educationDecisionEmail.findUnique({
      where: {
        offeringId_status: { offeringId: args.offeringId, status: args.status },
      },
      select: {
        emailTemplateVersion: { select: { subject: true, body: true } },
      },
    });

    const { subject, html } = renderEmail(
      binding?.emailTemplateVersion ?? {
        subject: args.fallback.subject,
        body: args.fallback.body,
      },
      // {{domain}} carries the offering title in education templates.
      { firstName: args.applicant.firstName, domain: args.offeringTitle },
    );

    await sendEmail({
      refreshToken,
      to,
      subject,
      html: redirectBannerHtml(redirectedFrom) + html,
    });
  } catch (err) {
    console.error("education decision email failed", {
      offeringId: args.offeringId,
      status: args.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
