import { prisma } from "~/lib/db";
import { notify, renderNotificationEmail } from "~/lib/notify.server";
import { sendEmail } from "~/lib/gmail";
import { getSender } from "~/lib/gmail-integration";
import { getAppEnv, getFrontendUrl } from "~/lib/app-env";
import { slackConfigured, sendDm } from "~/slack/lib/slack-client";

// Deep-link for the welcome todo and Core reminders.
export const ONBOARDING_LINK = "/onboarding";

// Preference / lock key for the persistent welcome todo. Reminders use
// `member.onboarding.reminder` so they stay dismissible and don't inherit the
// "can't mark read" lock that applies only to this event.
export const ONBOARDING_EVENT_TYPE = "member.onboarding" as const;
export const ONBOARDING_REMINDER_EVENT_TYPE = "member.onboarding.reminder" as const;

// Welcome a newly-promoted member by dropping a persistent "finish onboarding"
// todo notification (links to /onboarding). Best-effort — a failure here must
// never block the acceptance/release that triggered it, so callers wrap this in
// try/catch.
//
// The onboarding *email* is no longer sent separately: its content is folded
// into the Accepted decision email at the release call site via
// `onboardingEmailHtml` below, so an accepted applicant receives a single email.
//
// Idempotent: re-running creates another notification only if the member has no
// open onboarding todo, so a re-release won't spam them.

// Mark a member's onboarding task read so it drops out of their task list. Call
// this when onboarding is finished (onboardedAt set). Also clears unread Core
// reminders for the same flow. Idempotent.
export async function clearOnboardingTask(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      recipientUserId: userId,
      eventType: {
        in: [ONBOARDING_EVENT_TYPE, ONBOARDING_REMINDER_EVENT_TYPE],
      },
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

export async function sendWelcome(args: {
  userId: string;
  actorId: string;
  // For the email greeting + the address to send to. Kept for call-site parity;
  // the email itself is now part of the Accepted decision email.
  firstName: string;
  email: string | null;
  // The member's newly-provisioned @dali.dartmouth.edu login email, if any.
  daliEmail?: string | null;
}): Promise<{ notified: boolean }> {
  // The onboarding task links to the /onboarding checklist (the profile form is
  // one step within it). It is a plain todo — NOT form-backed — so submitting
  // the profile form alone doesn't clear it; it stays until onboarding is fully
  // finished (clearOnboardingTask, called when onboardedAt is set).
  let notified = false;
  // Don't re-notify on a re-release: only create if there's no existing
  // onboarding todo for this member.
  const existing = await prisma.notification.findFirst({
    where: {
      recipientUserId: args.userId,
      eventType: ONBOARDING_EVENT_TYPE,
    },
    select: { id: true },
  });
  if (!existing) {
    await notify({
      eventType: ONBOARDING_EVENT_TYPE,
      createdByUserId: args.actorId,
      message: {
        title: "Welcome to DALI — finish onboarding",
        body: "Complete a few quick steps to finish setting up your account.",
        isTodo: true,
        link: ONBOARDING_LINK,
      },
      recipients: [{ userId: args.userId }],
    });
    notified = true;
  }

  return { notified };
}

export type OnboardingReminderStep = "email" | "slack" | "figma" | "profile";

/** Exactly one channel — never in-app + email/Slack together. */
export type OnboardingRemindVia =
  | "inApp"
  | "emailDali"
  | "emailDartmouth"
  | "slack";

const REMIND_VIA_VALUES = [
  "inApp",
  "emailDali",
  "emailDartmouth",
  "slack",
] as const;

export function isOnboardingRemindVia(v: string): v is OnboardingRemindVia {
  return (REMIND_VIA_VALUES as readonly string[]).includes(v);
}

const REMINDER_COPY: Record<
  OnboardingReminderStep,
  { title: string; body: string; link: string | null }
> = {
  email: {
    title: "Onboarding reminder: DALI email",
    body: "Your DALI email isn't set up yet. Check for an invite, or reach out to Core if you still can't sign in.",
    link: ONBOARDING_LINK,
  },
  slack: {
    title: "Onboarding reminder: Slack",
    body: "You're not in the DALI Slack workspace yet. A teammate will add you — reply to Core if you're still waiting.",
    link: ONBOARDING_LINK,
  },
  figma: {
    title: "Onboarding reminder: Figma",
    body: "You haven't been added to Figma yet. Core will invite you — ping them if it's been a while.",
    link: ONBOARDING_LINK,
  },
  profile: {
    title: "Onboarding reminder: profile form",
    body: "Finish your member profile so we can complete your onboarding.",
    link: ONBOARDING_LINK,
  },
};

/**
 * One-shot Core nudge for members still incomplete on a board column.
 * `via` picks a single channel: DALI OS in-app, Slack DM, or email to either
 * the DALI or Dartmouth address — never more than one channel at a time.
 */
export async function sendOnboardingReminders(args: {
  actorId: string;
  step: OnboardingReminderStep;
  userIds: string[];
  via: OnboardingRemindVia;
}): Promise<{ count: number; skipped: number }> {
  const unique = [...new Set(args.userIds.filter(Boolean))];
  if (unique.length === 0) return { count: 0, skipped: 0 };

  const copy = REMINDER_COPY[args.step];
  const base = getFrontendUrl().replace(/\/$/, "");
  const absLink = copy.link
    ? `${base}${copy.link.startsWith("/") ? "" : "/"}${copy.link}`
    : null;

  if (args.via === "inApp") {
    await notify({
      eventType: ONBOARDING_REMINDER_EVENT_TYPE,
      createdByUserId: args.actorId,
      message: {
        title: copy.title,
        body: copy.body,
        link: copy.link,
        isTodo: true,
      },
      recipients: unique.map((userId) => ({ userId })),
    });
    return { count: unique.length, skipped: 0 };
  }

  if (args.via === "slack") {
    if (!slackConfigured()) {
      throw new Error("Slack is not configured");
    }
    // Same prod gate as notify(): staging DBs mirror prod Slack ids.
    if (getAppEnv() !== "prod" && process.env.NOTIFY_SLACK_DM_OVERRIDE !== "1") {
      throw new Error(
        "Slack DMs are production-only (set NOTIFY_SLACK_DM_OVERRIDE=1 to test)",
      );
    }

    const users = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, slackUserId: true },
    });

    const text = [
      `*${copy.title}*`,
      copy.body,
      absLink,
    ]
      .filter(Boolean)
      .join("\n\n");

    let count = 0;
    let skipped = 0;
    for (const u of users) {
      if (!u.slackUserId) {
        skipped++;
        continue;
      }
      await sendDm(u.slackUserId, text);
      count++;
    }
    return { count, skipped };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      firstName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });

  const sender = await getSender("General").catch(() => null);
  if (!sender) {
    throw new Error("Email sender is not configured");
  }

  let count = 0;
  let skipped = 0;
  for (const u of users) {
    const to = args.via === "emailDali" ? u.daliEmail : u.dartmouthEmail;
    if (!to) {
      skipped++;
      continue;
    }
    await sendEmail({
      refreshToken: sender.refreshToken,
      from: sender.sendAsEmail,
      to,
      subject: copy.title,
      html: renderNotificationEmail({
        firstName: u.firstName,
        title: copy.title,
        body: copy.body,
        link: absLink,
      }),
    });
    count++;
  }

  return { count, skipped };
}

// Onboarding block appended to the Accepted decision email so a new member gets
// a single email. The acceptance greeting ("Hi <name>, congratulations…") comes
// from the lead-authored decision template; this block adds the first onboarding
// step (log in to DALI OS with the new credentials), the profile nudge, the
// sign-off, and the DALI logo.
//
// daliEmail is the newly-provisioned @dali.dartmouth.edu login address. It may
// be null when Workspace provisioning hasn't completed yet (e.g. a transient
// failure) — in that case we say the account is still being set up rather than
// showing a blank "ready" line, so the member isn't told to log in with an
// address that doesn't exist.
//
// tempPassword is the one-time initial password for a freshly-created account
// (the account forces a password change at first login). When present it's shown
// alongside the email so the member can actually sign in. It is null when the
// account already existed (re-release) — then we just tell them to use their
// existing password. SECURITY: this is a live credential; it must only ever be
// rendered into this email, never logged.
export function onboardingEmailHtml(
  daliEmail: string | null,
  tempPassword: string | null = null,
): string {
  const base = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
  const loginUrl = `${base}/login`;
  const logoUrl = `${base}/logo-blue.png`;

  const loginLink = `<a href="${loginUrl}">DALI OS</a>`;

  // Slack onboarding line. Our Slack is on Enterprise, which disallows the public
  // shared invite-link feature, and the programmatic admin.users.invite isn't
  // available to us either — so workspace invites are always done by hand. We
  // point new members at the workspace and tell them a teammate/admin will add
  // them; any member can invite, so this is reliable.
  const slackWorkspaceUrl =
    (process.env.SLACK_WORKSPACE_URL ?? "https://dali-lab.slack.com").replace(/\/$/, "");
  const slackLine = `<p>We use Slack day-to-day at <a href="${slackWorkspaceUrl}">DALI Studios</a> — a teammate will add you to the workspace shortly.</p>`;

  let accountBlock: string;
  if (daliEmail && tempPassword) {
    accountBlock = `
      <p>As your first onboarding step, log in to ${loginLink} with your new credentials:</p>
      <p style="margin:8px 0;padding:12px 16px;background:#f3f4f6;border-radius:6px;font-family:monospace;">
        DALI email: <strong>${daliEmail}</strong><br/>
        Password: <strong>${tempPassword}</strong> (you'll be asked to set a password on first login).
      </p>`;
  } else if (daliEmail) {
    accountBlock = `<p>As your first onboarding step, log in to ${loginLink} with your new DALI email: <strong>${daliEmail}</strong> and your existing password.</p>`;
  } else {
    accountBlock = `<p>Your DALI account is being set up — you'll receive your DALI login email shortly. In the meantime you can finish the rest of your onboarding below.</p>`;
  }

  return `
    ${accountBlock}
    <p>Once you're in, finish setting up by completing your member profile and onboarding steps.</p>
    <p><strong>The deadline to accept your offer and complete onboarding is June 8th, 2026.</strong></p>
    ${slackLine}
    <p>We also have a special event planned for all day Sunday, September 13th. This is a required event. If there is any concern with this requirement, please reach out.</p>
    <p>We are very excited to welcome you to DALI soon and look forward to an incredible 26F together. Please reach out with any questions.</p>
    <p>Best,<br/>Sean Noh and DALI Hiring</p>
    <p><img src="${logoUrl}" alt="DALI Lab" width="96" style="display:block;border:0;"/></p>
  `;
}
