// Digest emails: one batched email per member summarizing what they haven't
// read, for (user, eventType) pairs whose NotificationPreference is Daily or
// Weekly. Runs as two registered jobs (notification-digest-daily/-weekly) on a
// 15-minute tick. Each member's digest goes out in the window after their ET
// hour (their own choice in Settings, else the job's configured hour; weekly
// also gates on the job's weekday). The outbox row keyed
// `digest:{freq}:{user}:{ET day}` is the per-member sent-today cursor.
//
// `emailedAt IS NULL` inside the cadence window is the row selection.
// Claim-before-send: the rows are marked emailed AND the digest is enqueued to
// the outbox in one transaction, so a crash can't leave rows unmarked (and
// re-sent); the outbox then owns delivery (retry + dead-letter).

import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";
import { escapeHtml } from "~/lib/email";
import { renderEmailDocument } from "~/email/lib/layout";
import { getZonedParts, zonedWallTimeUtc, APPLICATION_TZ } from "~/lib/timezone";
import { NOT_CANCELLED_MEETING } from "~/lib/notifications";
import { EVENT_TYPES, type EventDef } from "~/lib/notification-events";
import type { JobContext, JobResult } from "~/jobs/registry";

export type DigestFrequency = "Daily" | "Weekly";

// Collection windows carry slack past the nominal cadence so a late job
// start can't orphan rows; pre-feature rows (emailedAt null forever) age out.
const WINDOW_MS: Record<DigestFrequency, number> = {
  Daily: 26 * 3_600_000,
  Weekly: 8 * 24 * 3_600_000,
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Exported for jobs that gate on the ET weekday (standup prompts).
export function weekdayInZone(date: Date): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: APPLICATION_TZ,
    weekday: "short",
  }).format(date);
  return WEEKDAY_INDEX[name] ?? 0;
}

export type DigestSchedule = {
  sendHourEt: number;
  // Only consulted for Weekly (0=Sun … 6=Sat).
  sendWeekday?: number;
};

/** Pure gate for jobs with one lab-wide send time (standup prompts, timesheet
 *  reminders): has today's (ET) send moment arrived without a send since? */
export function shouldRunDigest(
  freq: DigestFrequency,
  lastSuccessAt: Date | null,
  now: Date,
  schedule: DigestSchedule,
): boolean {
  if (!digestDue(freq, now, schedule.sendHourEt, schedule.sendWeekday)) return false;
  const { year, month, day } = getZonedParts(now, APPLICATION_TZ);
  const sendMoment = zonedWallTimeUtc(year, month, day, schedule.sendHourEt, 0, APPLICATION_TZ);
  return lastSuccessAt === null || lastSuccessAt < sendMoment;
}

/** Pure gate: has today's (ET) send moment at `hourEt` arrived? */
export function digestDue(
  freq: DigestFrequency,
  now: Date,
  hourEt: number,
  sendWeekday = 1,
): boolean {
  if (freq === "Weekly" && weekdayInZone(now) !== sendWeekday) return false;
  const { year, month, day } = getZonedParts(now, APPLICATION_TZ);
  return now >= zonedWallTimeUtc(year, month, day, hourEt, 0, APPLICATION_TZ);
}

// How long after a member's hour their digest may still go out. Long enough to
// ride out a few missed ticks; short enough that a notification arriving in the
// evening waits for tomorrow's digest instead of sending one at night.
export const DIGEST_SEND_WINDOW_MS = 2 * 3_600_000;

/** Due at `hourEt` today and still inside the send window. */
export function inDigestWindow(
  freq: DigestFrequency,
  now: Date,
  hourEt: number,
  sendWeekday = 1,
): boolean {
  if (!digestDue(freq, now, hourEt, sendWeekday)) return false;
  const { year, month, day } = getZonedParts(now, APPLICATION_TZ);
  const opens = zonedWallTimeUtc(year, month, day, hourEt, 0, APPLICATION_TZ);
  return now.getTime() < opens.getTime() + DIGEST_SEND_WINDOW_MS;
}

/** The ET calendar day, "yyyy-mm-dd": one digest per member per day. */
export function etDay(now: Date): string {
  const { year, month, day } = getZonedParts(now, APPLICATION_TZ);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function digestDedupKey(freq: DigestFrequency, userId: string, now: Date): string {
  return `digest:${freq}:${userId}:${etDay(now)}`;
}

function relativeTime(from: Date, to: Date): string {
  const hours = Math.max(0, Math.round((to.getTime() - from.getTime()) / 3_600_000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export type DigestRow = {
  eventType: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: Date;
};

export type DigestArgs = { firstName: string; now: Date; rows: DigestRow[] };

function groupByLabel(rows: DigestRow[]): Map<string, DigestRow[]> {
  const byLabel = new Map<string, DigestRow[]>();
  for (const row of rows) {
    const def: EventDef | undefined = EVENT_TYPES[row.eventType as keyof typeof EVENT_TYPES];
    const label = def?.label ?? "Other";
    const list = byLabel.get(label) ?? [];
    list.push(row);
    byLabel.set(label, list);
  }
  return byLabel;
}

function absolute(link: string | null, base: string): string | null {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  return `${base}${link.startsWith("/") ? "" : "/"}${link}`;
}

// Titles and bodies come from notification rows, which carry user-authored text
// (task titles, comment snippets, partner names). They were interpolated raw.
function sectionsHtml(args: DigestArgs, base: string): string {
  return [...groupByLabel(args.rows).entries()]
    .map(([label, rows]) => {
      const items = rows
        .map((r) => {
          const href = absolute(r.link, base);
          const safeTitle = escapeHtml(r.title);
          const title = href
            ? `<a href="${escapeHtml(href)}" style="color:#1d4ed8;">${safeTitle}</a>`
            : safeTitle;
          const snippet = r.body
            ? ` <span style="color:#52525b;">${escapeHtml(r.body.slice(0, 120))}</span>`
            : "";
          return `<li style="margin:6px 0;"><strong>${title}</strong>${snippet} <span style="color:#71717a;font-size:12px;">${relativeTime(r.createdAt, args.now)}</span></li>`;
        })
        .join("\n");
      return `<h2 style="margin:20px 0 4px;font-size:15px;line-height:22px;">${escapeHtml(label)}</h2>\n<ul style="margin:0;padding-left:20px;">${items}</ul>`;
    })
    .join("\n");
}

// No em dash, per the house copy style; the colon reads the same and survives
// every client's encoding.
export function digestSubject(n: number): string {
  return `Your DALI digest: ${n} update${n === 1 ? "" : "s"}`;
}

function digestText(args: DigestArgs, base: string): string {
  const parts = [`Hi ${args.firstName},`, "Here's what you haven't read on DALI OS:"];
  for (const [label, rows] of groupByLabel(args.rows)) {
    const lines = rows.map((r) => {
      const href = absolute(r.link, base);
      return `- ${r.title}${r.body ? ` — ${r.body.slice(0, 120)}` : ""}${href ? `\n  ${href}` : ""}`;
    });
    parts.push(`${label}\n${lines.join("\n")}`);
  }
  parts.push(`DALI OS · ${base}/settings/notifications`);
  return parts.join("\n\n");
}

export function renderDigestEmailDocument(args: DigestArgs): {
  subject: string;
  html: string;
  text: string;
} {
  const base = getFrontendUrl();
  const n = args.rows.length;
  return {
    subject: digestSubject(n),
    html: renderEmailDocument({
      bodyHtml: [
        `<p style="margin:0 0 16px;">Hi ${escapeHtml(args.firstName)},</p>`,
        `<p style="margin:0;">Here's what you haven't read on DALI OS:</p>`,
        sectionsHtml(args, base),
      ].join("\n"),
      preheader: `${n} update${n === 1 ? "" : "s"} waiting on DALI OS`,
      cta: { href: base, label: "Open DALI OS" },
      footer: "notifications",
      baseUrl: base,
    }),
    text: digestText(args, base),
  };
}

export async function runDigest(
  freq: DigestFrequency,
  now: Date,
  schedule: DigestSchedule,
): Promise<JobResult> {
  const prefs = await prisma.notificationPreference.findMany({
    where: { digestFrequency: freq },
    select: { userId: true, eventType: true },
  });
  if (prefs.length === 0) return { items: 0, note: "no subscribers" };

  const wantedByUser = new Map<string, Set<string>>();
  for (const p of prefs) {
    const set = wantedByUser.get(p.userId) ?? new Set<string>();
    set.add(p.eventType);
    wantedByUser.set(p.userId, set);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...wantedByUser.keys()] } },
    select: {
      id: true,
      firstName: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      digestHourEt: true,
    },
  });
  const due = users.filter((u) =>
    inDigestWindow(freq, now, u.digestHourEt ?? schedule.sendHourEt, schedule.sendWeekday),
  );
  if (due.length === 0) return { items: 0, note: "not due" };

  // The outbox row is the per-member "sent today" cursor. Checking it before
  // claiming rows matters: claiming and then hitting the dedup key would mark
  // rows emailed that never went out.
  const keyByUser = new Map(due.map((u) => [u.id, digestDedupKey(freq, u.id, now)]));
  const alreadySent = new Set(
    (
      await prisma.outboundMessage.findMany({
        where: { channel: "email", dedupKey: { in: [...keyByUser.values()] } },
        select: { dedupKey: true },
      })
    ).map((m) => m.dedupKey),
  );
  const pending = due.filter((u) => !alreadySent.has(keyByUser.get(u.id)!));
  if (pending.length === 0) return { items: 0, note: "already sent" };

  const rows = await prisma.notification.findMany({
    where: {
      recipientUserId: { in: pending.map((u) => u.id) },
      emailedAt: null,
      readAt: null,
      createdAt: { gte: new Date(now.getTime() - WINDOW_MS[freq]) },
      ...NOT_CANCELLED_MEETING,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      recipientUserId: true,
      eventType: true,
      title: true,
      body: true,
      link: true,
      createdAt: true,
    },
  });
  const matched = rows.filter((r) => wantedByUser.get(r.recipientUserId)?.has(r.eventType));
  if (matched.length === 0) return { items: 0, note: "nothing unread" };

  const enqueuedIds: Array<string | null> = [];
  let sent = 0;
  for (const user of pending) {
    const userId = user.id;
    const to = user.daliEmail ?? user.dartmouthEmail ?? user.personalEmail;
    if (!to) continue;
    const userRows = matched.filter((r) => r.recipientUserId === userId);
    if (userRows.length === 0) continue; // no empty digests

    const digestArgs = { firstName: user.firstName, now, rows: userRows };
    const { subject, html, text } = renderDigestEmailDocument(digestArgs);
    try {
      // Mark-and-enqueue atomically: rows can't be marked without the digest
      // being queued, nor queued without the rows being marked.
      const id = await prisma.$transaction(async (tx) => {
        await tx.notification.updateMany({
          where: { id: { in: userRows.map((r) => r.id) } },
          data: { emailedAt: now },
        });
        const enq = await enqueueOutbound(
          {
            channel: "email",
            purpose: "General",
            dedupKey: keyByUser.get(userId)!,
            target: to,
            recipientUserId: userId,
            subject,
            bodyHtml: html,
            bodyText: text,
            eventType: `digest.${freq.toLowerCase()}`,
          },
          tx,
        );
        return enq.id;
      });
      if (id) {
        enqueuedIds.push(id);
        sent += 1;
      }
    } catch (err) {
      // Rows stay emailedAt-null and fall into the next run's window.
      console.error(`[jobs] digest enqueue for ${userId} failed:`, err);
    }
  }

  await drainNow(enqueuedIds);
  return { items: sent };
}

export async function runDailyDigest({ now, settings }: JobContext): Promise<JobResult> {
  return runDigest("Daily", now, { sendHourEt: settings.sendHourEt });
}

export async function runWeeklyDigest({ now, settings }: JobContext): Promise<JobResult> {
  return runDigest("Weekly", now, {
    sendHourEt: settings.sendHourEt,
    sendWeekday: settings.sendWeekday,
  });
}
