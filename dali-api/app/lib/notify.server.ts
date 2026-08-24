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
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { bodyToHtml, sanitizeRichEmailHtml } from "~/lib/email";
import { getAppEnv, getFrontendUrl } from "~/lib/app-env";
import { slackConfigured } from "~/slack/lib/slack-client";
import { publishNotificationChange } from "~/lib/notify-stream.server";
import { EVENT_TYPES, type EventDef, type EventType } from "~/lib/notification-events";
import { Prisma, type NotificationKind } from "~/generated/prisma/client";

export type NotifyMessage = {
  title: string;
  body?: string | null;
  bodyHtml?: string | null; // sanitized rich HTML for the email channel only
  link?: string | null; // app-relative; email/Slack renderers absolutize
  linkLabel?: string | null; // overrides the email CTA button label
  isTodo?: boolean;
  dueAt?: Date | null;
  formId?: string | null;
  scheduledMeetingId?: string | null;
  interviewAssignmentId?: string | null;
  sourceGroupId?: string | null;
  kind?: NotificationKind; // rare override of the registry kind
  // Opt-in idempotency key. When set, the in-app row claims (recipientUserId,
  // dedupKey) — a re-fired notify() with the same key no-ops instead of
  // duplicating — and the email/Slack channels ride the outbox with a derived
  // forever key. Null/omitted → today's behavior (always delivers).
  dedupKey?: string | null;
  // RFC 5545 payload attached on the instant-email channel only (calendar
  // invite/cancel). Never persisted — the Notification row doesn't carry it.
  ics?: string | null;
  // Email-only: also deliver to the recipient's Dartmouth address in the same
  // message (announcement composer toggle). Never persisted on the row.
  ccDartmouth?: boolean;
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
  bodyHtml?: string | null;
  link?: string | null;
  linkLabel?: string | null;
  // Whether to repeat the title as a heading in the body. Default true. The
  // title is always the email subject, so callers whose body already stands on
  // its own (announcements with a body) pass false to avoid duplicating it.
  titleInBody?: boolean;
}): string {
  const label = args.linkLabel || "Open in DALI OS";
  const button = args.link
    ? `<p><a href="${args.link}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a></p>`
    : "";
  const body = args.bodyHtml
    ? sanitizeRichEmailHtml(args.bodyHtml)
    : args.body
      ? bodyToHtml(args.body)
      : "";
  return [
    `<p>Hi ${args.firstName},</p>`,
    args.titleInBody === false ? "" : `<p><strong>${args.title}</strong></p>`,
    body,
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
  let resolved: Resolved[] = [];
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
  // Email-only channel extras (like ics): resolved per-recipient, never written
  // to the Notification row.
  const bodyHtmlFor = (r: NotifyRecipient) => r.bodyHtml ?? args.message.bodyHtml ?? null;
  const linkLabelFor = (r: NotifyRecipient) => r.linkLabel ?? args.message.linkLabel ?? null;
  const ccDartmouthFor = (r: NotifyRecipient) => r.ccDartmouth ?? args.message.ccDartmouth ?? false;
  const dedupKeyFor = (r: NotifyRecipient) => r.dedupKey ?? args.message.dedupKey ?? null;
  // The title is always the email subject; for announcements that carry a body
  // the in-body title heading is redundant, so drop it (a body-less
  // announcement still shows it, so the email is never empty).
  const isAnnouncement = args.eventType === "announcement";

  // Coalescing (best-effort, opt-in per event): drop a recipient who already got
  // a row for this event+link inside the window — suppresses a burst (5 comments
  // → 1 notification). It never aggregates; a rare race just delivers the burst,
  // which is the un-coalesced behavior, so a plain findFirst (not an atomic
  // claim) is fine.
  if (def.coalesceWindowMs && resolved.length > 0) {
    const since = new Date(Date.now() - def.coalesceWindowMs);
    const kept: Resolved[] = [];
    for (const r of resolved) {
      const link = merged(r.recipient).link;
      if (link) {
        const recent = await prisma.notification.findFirst({
          where: {
            recipientUserId: r.user.id,
            eventType: args.eventType,
            link,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        if (recent) continue;
      }
      kept.push(r);
    }
    resolved = kept;
  }

  // In-app: unkeyed recipients keep the fast bulk insert; keyed recipients each
  // claim (recipientUserId, dedupKey) with a per-recipient insert so a re-fire
  // no-ops on the unique constraint instead of aborting the whole batch.
  const inAppTargets = resolved.filter((r) => r.inApp);
  const rows: { id: string; recipientUserId: string }[] = [];

  const unkeyed = inAppTargets.filter((r) => !dedupKeyFor(r.recipient));
  if (unkeyed.length > 0) {
    const created = await prisma.notification.createManyAndReturn({
      data: unkeyed.map((r) => ({
        recipientUserId: r.user.id,
        createdByUserId: args.createdByUserId ?? null,
        eventType: args.eventType,
        ...merged(r.recipient),
      })),
      select: { id: true, recipientUserId: true },
    });
    rows.push(...created);
  }

  const keyed = inAppTargets.filter((r) => dedupKeyFor(r.recipient));
  for (const r of keyed) {
    try {
      const row = await prisma.notification.create({
        data: {
          recipientUserId: r.user.id,
          createdByUserId: args.createdByUserId ?? null,
          eventType: args.eventType,
          dedupKey: dedupKeyFor(r.recipient),
          ...merged(r.recipient),
        },
        select: { id: true, recipientUserId: true },
      });
      rows.push(row);
    } catch (err) {
      // Already claimed by an earlier fire — a duplicate we absorb.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }

  const rowIdByUser = new Map(rows.map((row) => [row.recipientUserId, row.id]));

  // Ping open notification streams (desktop app) so new rows surface without
  // waiting for the stream's sync backstop. In-memory, never throws.
  if (rows.length > 0) {
    publishNotificationChange(rows.map((row) => row.recipientUserId));
  }

  // A keyed in-app recipient whose row was deduped away is a full duplicate —
  // skip its email/Slack too. (Keyed email-only recipients aren't in `keyed`;
  // their outbox dedupKey enforces idempotency instead.)
  const dedupedInApp = new Set(
    keyed.filter((r) => !rowIdByUser.has(r.user.id)).map((r) => r.user.id),
  );

  // Outbound (email + Slack DM) → the outbox. Enqueue is the claim; drainNow at
  // the end attempts them inline so interactive sends still land in the request.
  const enqueuedIds: Array<string | null> = [];

  let emailed = 0;
  for (const r of resolved.filter((x) => x.instantEmail)) {
    if (dedupedInApp.has(r.user.id)) continue;
    // Same chain as education's recipientEmail(): the netId fallback only fires
    // for portal students (members always have daliEmail). ccDartmouth delivers
    // to both work addresses in one comma-joined To:.
    const dartmouth =
      r.user.dartmouthEmail ?? (r.user.netId ? `${r.user.netId}@dartmouth.edu` : null);
    const to = ccDartmouthFor(r.recipient)
      ? Array.from(new Set([r.user.daliEmail, dartmouth].filter(Boolean))).join(", ") || null
      : (r.user.daliEmail ??
        r.user.dartmouthEmail ??
        r.user.personalEmail ??
        (r.user.netId ? `${r.user.netId}@dartmouth.edu` : null));
    if (!to) continue;
    const m = merged(r.recipient);
    const bodyHtml = bodyHtmlFor(r.recipient);
    const key = dedupKeyFor(r.recipient);
    const enq = await enqueueOutbound({
      channel: "email",
      purpose: "General",
      dedupKey: key ? `notif:${key}:${r.user.id}:email` : null,
      target: to,
      recipientUserId: r.user.id,
      notificationId: rowIdByUser.get(r.user.id) ?? null,
      subject: m.title,
      bodyHtml: renderNotificationEmail({
        firstName: r.user.firstName,
        title: m.title,
        body: m.body,
        bodyHtml,
        link: absoluteLink(m.link),
        linkLabel: linkLabelFor(r.recipient),
        titleInBody: !(isAnnouncement && (bodyHtml || m.body)),
      }),
      ics: icsFor(r.recipient),
      eventType: args.eventType,
      createdByUserId: args.createdByUserId ?? null,
    });
    if (!enq.deduped) {
      enqueuedIds.push(enq.id);
      emailed += 1;
    }
  }

  // Slack DM — prod-gated at enqueue so staging never writes a Slack row (the
  // drain also refuses to send them, as defense-in-depth).
  let slackDmed = 0;
  const dmTargets = resolved.filter((r) => r.slackDm && r.user.slackUserId);
  if (slackConfigured() && slackDmAllowed()) {
    for (const r of dmTargets) {
      if (dedupedInApp.has(r.user.id)) continue;
      const m = merged(r.recipient);
      const key = dedupKeyFor(r.recipient);
      const enq = await enqueueOutbound({
        channel: "slack_dm",
        dedupKey: key ? `notif:${key}:${r.user.id}:slack` : null,
        target: r.user.slackUserId!,
        recipientUserId: r.user.id,
        notificationId: rowIdByUser.get(r.user.id) ?? null,
        slackText: slackDmText({ title: m.title, body: m.body, link: absoluteLink(m.link) }),
        eventType: args.eventType,
        createdByUserId: args.createdByUserId ?? null,
      });
      if (!enq.deduped) {
        enqueuedIds.push(enq.id);
        slackDmed += 1;
      }
    }
  } else if (!slackDmAllowed() && dmTargets.length > 0) {
    console.info(
      `[slack-dm:${getAppEnv()}] skipped ${dmTargets.length} DM(s) for ${args.eventType} (prod-only; set NOTIFY_SLACK_DM_OVERRIDE=1 to test)`,
    );
  }

  await drainNow(enqueuedIds);
  return { inApp: rows.length, emailed, slackDmed };
}
