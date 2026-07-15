// Central notification dispatcher — the single write path for member-facing
// notifications. Resolves each recipient's channels (in-app, instant email,
// Slack DM) from NotificationPreference rows with registry defaults
// (app/lib/notification-events.ts), writes Notification rows in one bulk
// insert, then delivers the outbound channels best-effort: the in-app write
// is the only step allowed to throw, so callers keep their existing
// fire-and-forget conventions and an email/Slack hiccup never loses the
// in-app row.
//
// Works identically from a request or a background job — nothing here reads
// request state (Gmail token comes from the DB, URLs from env).

import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { bodyToHtml } from "~/lib/email";
import { getAppEnv, getFrontendUrl } from "~/lib/app-env";
import { slackConfigured, sendDm } from "~/slack/lib/slack-client";
import { EVENT_TYPES, type EventDef, type EventType } from "~/lib/notification-events";
import type { NotificationKind } from "~/generated/prisma/client";

export type NotifyMessage = {
  title: string;
  body?: string | null;
  link?: string | null; // app-relative; email/Slack renderers absolutize
  isTodo?: boolean;
  dueAt?: Date | null;
  formId?: string | null;
  scheduledMeetingId?: string | null;
  interviewAssignmentId?: string | null;
  sourceGroupId?: string | null;
  kind?: NotificationKind; // rare override of the registry kind
  // RFC 5545 payload attached on the instant-email channel only (calendar
  // invite/cancel). Never persisted — the Notification row doesn't carry it.
  ics?: string | null;
};

export type NotifyRecipient = { userId: string } & Partial<NotifyMessage>;

export type NotifyResult = { inApp: number; emailed: number; slackDmed: number };

// Slack DMs are prod-only: the staging DB is restored from a prod snapshot
// on every deploy, so real members' Slack ids live there and a staging job
// would DM real people. (Email needs no gate here — sendEmail() itself skips
// on dev and redirects on staging.)
function slackDmAllowed(): boolean {
  return getAppEnv() === "prod" || process.env.NOTIFY_SLACK_DM_OVERRIDE === "1";
}

function absoluteLink(link: string | null | undefined): string | null {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  return `${getFrontendUrl()}${link.startsWith("/") ? "" : "/"}${link}`;
}

// One generic template for every notify() email. Feature-owned templates
// (hiring decisions, education decision emails) stay on their own pipelines.
export function renderNotificationEmail(args: {
  firstName: string;
  title: string;
  body?: string | null;
  link?: string | null;
}): string {
  const button = args.link
    ? `<p><a href="${args.link}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;">Open in DALI OS</a></p>`
    : "";
  return [
    `<p>Hi ${args.firstName},</p>`,
    `<p><strong>${args.title}</strong></p>`,
    args.body ? bodyToHtml(args.body) : "",
    button,
    `<p style="color:#71717a;font-size:12px;">— DALI OS · <a href="${getFrontendUrl()}/settings/notifications" style="color:#71717a;">notification settings</a></p>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function slackDmText(args: { title: string; body?: string | null; link?: string | null }): string {
  const lines = [`*${args.title}*`];
  if (args.body) lines.push(args.body);
  if (args.link) lines.push(`<${args.link}|Open in DALI OS>`);
  return lines.join("\n");
}

export async function notify(args: {
  eventType: EventType;
  createdByUserId?: string | null;
  message: NotifyMessage;
  recipients: NotifyRecipient[];
}): Promise<NotifyResult> {
  // Widen to EventDef: the `as const` registry narrows each entry, dropping
  // optional props from entries that omit them.
  const def: EventDef = EVENT_TYPES[args.eventType];

  // Dedupe by userId — first occurrence wins (per-recipient overrides are
  // built by the caller, duplicates are caller bugs we absorb).
  const byUser = new Map<string, NotifyRecipient>();
  for (const r of args.recipients) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, r);
  }
  if (byUser.size === 0) return { inApp: 0, emailed: 0, slackDmed: 0 };
  const userIds = [...byUser.keys()];

  const [prefRows, users] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, eventType: args.eventType },
    }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        firstName: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        netId: true,
        slackUserId: true,
      },
    }),
  ]);
  const prefByUser = new Map(prefRows.map((p) => [p.userId, p]));
  const userById = new Map(users.map((u) => [u.id, u]));

  type Resolved = {
    recipient: NotifyRecipient;
    user: (typeof users)[number];
    inApp: boolean;
    instantEmail: boolean;
    slackDm: boolean;
  };
  const resolved: Resolved[] = [];
  for (const [userId, recipient] of byUser) {
    const user = userById.get(userId);
    if (!user) continue; // stale id — nothing sensible to deliver
    const pref = prefByUser.get(userId);
    const email = def.externalEmail ? "Off" : (pref?.digestFrequency ?? def.defaults.email);
    // A digest subscription implies the in-app row: digests are built from
    // unread Notification rows, so "in-app off + daily digest" would
    // otherwise deliver nothing at all.
    const digestSelected = email === "Daily" || email === "Weekly";
    resolved.push({
      recipient,
      user,
      inApp:
        def.lockedInApp || digestSelected ? true : (pref?.inApp ?? def.defaults.inApp),
      instantEmail: email === "Instant",
      slackDm: pref?.slackDm ?? def.defaults.slackDm,
    });
  }

  // Everything merged() returns is written to the Notification row — channel
  // extras (ics) resolve separately.
  const merged = (r: NotifyRecipient) => ({
    title: r.title ?? args.message.title,
    body: r.body ?? args.message.body ?? null,
    link: r.link ?? args.message.link ?? null,
    isTodo: r.isTodo ?? args.message.isTodo ?? false,
    dueAt: r.dueAt ?? args.message.dueAt ?? null,
    formId: r.formId ?? args.message.formId ?? null,
    scheduledMeetingId: r.scheduledMeetingId ?? args.message.scheduledMeetingId ?? null,
    interviewAssignmentId: r.interviewAssignmentId ?? args.message.interviewAssignmentId ?? null,
    sourceGroupId: r.sourceGroupId ?? args.message.sourceGroupId ?? null,
    kind: r.kind ?? args.message.kind ?? def.kind,
  });
  const icsFor = (r: NotifyRecipient) => r.ics ?? args.message.ics ?? null;

  // In-app: one bulk insert. May throw — that's the caller's existing
  // error-handling seam.
  const inAppTargets = resolved.filter((r) => r.inApp);
  const rows = inAppTargets.length
    ? await prisma.notification.createManyAndReturn({
        data: inAppTargets.map((r) => ({
          recipientUserId: r.user.id,
          createdByUserId: args.createdByUserId ?? null,
          eventType: args.eventType,
          ...merged(r.recipient),
        })),
        select: { id: true, recipientUserId: true },
      })
    : [];
  const rowIdByUser = new Map(rows.map((row) => [row.recipientUserId, row.id]));

  // Instant email — best-effort per recipient.
  let emailed = 0;
  const emailTargets = resolved.filter((r) => r.instantEmail);
  if (emailTargets.length > 0) {
    const refreshToken = await getApplicationsGmailRefreshToken().catch(() => null);
    if (refreshToken) {
      const emailedRowIds: string[] = [];
      for (const r of emailTargets) {
        // Same chain as education's recipientEmail(): the netId fallback only
        // ever fires for portal students (members always have daliEmail).
        const to =
          r.user.daliEmail ??
          r.user.dartmouthEmail ??
          r.user.personalEmail ??
          (r.user.netId ? `${r.user.netId}@dartmouth.edu` : null);
        if (!to) continue;
        const m = merged(r.recipient);
        try {
          await sendEmail({
            refreshToken,
            to,
            subject: m.title,
            html: renderNotificationEmail({
              firstName: r.user.firstName,
              title: m.title,
              body: m.body,
              link: absoluteLink(m.link),
            }),
            ics: icsFor(r.recipient) ?? undefined,
          });
          emailed++;
          const rowId = rowIdByUser.get(r.user.id);
          if (rowId) emailedRowIds.push(rowId);
        } catch (err) {
          console.error(`[notify] email to ${r.user.id} failed:`, err);
        }
      }
      if (emailedRowIds.length > 0) {
        await prisma.notification
          .updateMany({ where: { id: { in: emailedRowIds } }, data: { emailedAt: new Date() } })
          .catch((err) => console.error("[notify] emailedAt mark failed:", err));
      }
    }
  }

  // Slack DM — best-effort per recipient; null slackUserId silently skips
  // (the established convention).
  let slackDmed = 0;
  const dmTargets = resolved.filter((r) => r.slackDm && r.user.slackUserId);
  if (dmTargets.length > 0) {
    if (slackConfigured() && slackDmAllowed()) {
      const dmedRowIds: string[] = [];
      for (const r of dmTargets) {
        const m = merged(r.recipient);
        try {
          await sendDm(
            r.user.slackUserId!,
            slackDmText({ title: m.title, body: m.body, link: absoluteLink(m.link) }),
          );
          slackDmed++;
          const rowId = rowIdByUser.get(r.user.id);
          if (rowId) dmedRowIds.push(rowId);
        } catch (err) {
          console.error(`[notify] Slack DM to ${r.user.id} failed:`, err);
        }
      }
      if (dmedRowIds.length > 0) {
        await prisma.notification
          .updateMany({ where: { id: { in: dmedRowIds } }, data: { slackDmAt: new Date() } })
          .catch((err) => console.error("[notify] slackDmAt mark failed:", err));
      }
    } else if (!slackDmAllowed()) {
      console.info(
        `[slack-dm:${getAppEnv()}] skipped ${dmTargets.length} DM(s) for ${args.eventType} (prod-only; set NOTIFY_SLACK_DM_OVERRIDE=1 to test)`,
      );
    }
  }

  return { inApp: rows.length, emailed, slackDmed };
}
