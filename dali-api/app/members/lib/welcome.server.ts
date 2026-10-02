import { prisma } from "~/lib/db";
import { notify, renderNotificationEmail } from "~/lib/notify.server";
import { renderEmailTemplate } from "~/email/lib/templates.server";
import type { NotificationCopyKey } from "~/email/lib/notification-copy";
import {
  renderNotificationCopy,
  resolveNotificationCopy,
} from "~/email/lib/notification-render.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
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
        // Copy lives in the template now; this call only says which one.
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

// Which template writes each board column's nudge. The words live in
// app/email/lib/notification-copy.ts so Core can edit them; all four link to the
// same checklist. Resolved once below and shared by all three channels, so the
// in-app ping, the email and the Slack DM can't say different things.
const REMINDER_COPY_KEY: Record<OnboardingReminderStep, NotificationCopyKey> = {
  email: "member.onboarding.reminder.email",
  slack: "member.onboarding.reminder.slack",
  figma: "member.onboarding.reminder.figma",
  profile: "member.onboarding.reminder.profile",
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

  const copyKey = REMINDER_COPY_KEY[args.step];
  const resolved = await resolveNotificationCopy([copyKey]);
  const copy = renderNotificationCopy(resolved.get(copyKey), {});
  const base = getFrontendUrl().replace(/\/$/, "");
  const absLink = `${base}${ONBOARDING_LINK}`;

  if (args.via === "inApp") {
    await notify({
      eventType: ONBOARDING_REMINDER_EVENT_TYPE,
      createdByUserId: args.actorId,
      message: {
        copyKey,
        link: ONBOARDING_LINK,
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

    const text = [`*${copy.subject}*`, copy.body, absLink]
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

  let count = 0;
  let skipped = 0;
  const ids: Array<string | null> = [];
  for (const u of users) {
    const to = args.via === "emailDali" ? u.daliEmail : u.dartmouthEmail;
    if (!to) {
      skipped++;
      continue;
    }
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: "General",
      target: to,
      subject: copy.subject ?? "",
      bodyHtml: renderNotificationEmail({
        firstName: u.firstName,
        title: copy.subject ?? "",
        body: copy.body,
        link: absLink,
      }),
      recipientUserId: u.id,
      eventType: "member.onboarding",
    });
    ids.push(id);
    count++;
  }
  await drainNow(ids);

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
// Async because the prose is operator-editable now: the deadline, the
// required-event day, the term and the sign-off live in the
// hiring:onboarding:NextSteps template rather than in constants here, where they
// went stale silently and needed a deploy to correct.
export async function onboardingEmailHtml(
  daliEmail: string | null,
  tempPassword: string | null = null,
): Promise<string> {
  // getFrontendUrl(), not process.env.FRONTEND_URL: a PR preview app sets only
  // API_BASE_URL, so reading the raw var there left base="" and shipped a
  // relative "/login" and "/logo-blue.png" into an email, where neither resolves.
  const base = getFrontendUrl().replace(/\/$/, "");
  const loginUrl = `${base}/login`;
  const logoUrl = `${base}/logo-blue.png`;

  const loginLink = `<a href="${loginUrl}">DALI OS</a>`;

  // Our Slack is on Enterprise, which disallows the public shared invite-link
  // feature, and the programmatic admin.users.invite isn't available to us
  // either — so workspace invites are always done by hand. The template tells
  // the member a teammate will add them; this just supplies the workspace URL.
  const slackUrl =
    (process.env.SLACK_WORKSPACE_URL ?? "https://dali-lab.slack.com").replace(/\/$/, "");

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

  // whenMissing is "default", so this never comes back empty.
  const nextSteps = await renderEmailTemplate("hiring:onboarding:NextSteps", { slackUrl });

  return `
    ${accountBlock}
    ${nextSteps?.html ?? ""}
    <p><img src="${logoUrl}" alt="DALI Lab" width="96" style="display:block;border:0;"/></p>
  `;
}
