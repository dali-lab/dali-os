import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { renderMemberEmail } from "~/email/lib/layout.server";
import type { NotificationCopyKey } from "~/email/lib/notification-copy";
import {
  renderNotificationCopy,
  resolveNotificationCopy,
} from "~/email/lib/notification-render.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";
import { slackSendAllowed } from "~/slack/lib/send-gate";
import { slackConfigured } from "~/slack/lib/slack-client";

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
// The onboarding *email* is no longer sent separately: the Accepted decision
// letter renders the credentials itself (via `acceptanceEmailVars` below), so
// an accepted applicant receives a single email.
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
    if (!slackSendAllowed()) {
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
    const slackIds: Array<string | null> = [];
    for (const u of users) {
      if (!u.slackUserId) {
        skipped++;
        continue;
      }
      const { id } = await enqueueOutbound({
        channel: "slack_dm",
        target: u.slackUserId,
        recipientUserId: u.id,
        slackText: text,
        eventType: ONBOARDING_REMINDER_EVENT_TYPE,
        createdByUserId: args.actorId,
      });
      slackIds.push(id);
      count++;
    }
    await drainNow(slackIds);
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
    const mail = renderMemberEmail({
      firstName: u.firstName,
      title: copy.subject ?? "",
      body: copy.body,
      link: absLink,
    });
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: "General",
      target: to,
      subject: copy.subject ?? "",
      bodyHtml: mail.html,
      bodyText: mail.text,
      recipientUserId: u.id,
      eventType: "member.onboarding",
      createdByUserId: args.actorId,
    });
    ids.push(id);
    count++;
  }
  await drainNow(ids);

  return { count, skipped };
}

// The variables the Accepted letter's credential placeholders render from. One
// lead-authored template carries the whole acceptance email, and its save guard
// keeps {{daliEmail}} and {{tempPassword}} in the body — so this fills both
// tokens on every path rather than leaving one blank:
//
// - New account: the provisioned address and the one-time password (the account
//   forces a password change at first login). SECURITY: the password is a live
//   credential; it must only ever be rendered into this email, never logged.
// - Account already existed (re-release, or a Core-cycle acceptance of a
//   current member): their address plus "your existing password" in place of a
//   one-time one.
// - Workspace provisioning not finished (e.g. a transient failure): stand-in
//   text saying the login details arrive separately, so the member isn't told
//   to log in with an address that doesn't exist.
export function acceptanceEmailVars(
  provision: { daliEmail?: string | null; daliTempPassword?: string | null } | null,
  existingDaliEmail: string | null = null,
): { loginUrl: string; slackUrl: string; daliEmail: string; tempPassword: string } {
  // getFrontendUrl(), not process.env.FRONTEND_URL: a PR preview app sets only
  // API_BASE_URL, so reading the raw var there left base="" and shipped a
  // relative "/login" into an email, where it doesn't resolve.
  const base = getFrontendUrl().replace(/\/$/, "");

  // Our Slack is on Enterprise, which disallows the public shared invite-link
  // feature, and the programmatic admin.users.invite isn't available to us
  // either — so workspace invites are always done by hand. The template tells
  // the member a teammate will add them; this just supplies the workspace URL.
  const slackUrl =
    (process.env.SLACK_WORKSPACE_URL ?? "https://dali-lab.slack.com").replace(/\/$/, "");

  const daliEmail = provision?.daliEmail ?? existingDaliEmail ?? null;
  const tempPassword = provision?.daliTempPassword ?? null;
  return {
    loginUrl: `${base}/login`,
    slackUrl,
    daliEmail: daliEmail ?? "still being set up, it will arrive in a separate email",
    tempPassword:
      tempPassword ?? (daliEmail ? "your existing password" : "arriving with your DALI email"),
  };
}

// Appended after the Accepted letter in code: the logo is an <img>, which the
// email sanitizer does not allow through an operator-authored body.
export function acceptanceLogoHtml(): string {
  const base = getFrontendUrl().replace(/\/$/, "");
  return `<p><img src="${base}/logo-blue.png" alt="DALI Lab" width="96" style="display:block;border:0;"/></p>`;
}
