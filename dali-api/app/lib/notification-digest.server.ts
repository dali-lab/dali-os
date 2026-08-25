// Digest emails: one batched email per user summarizing what they haven't
// read, for (user, eventType) pairs whose NotificationPreference is Daily or
// Weekly. Runs as two registered jobs (notification-digest-daily/-weekly) on
// a 15-minute tick that self-gates on wall clock: sends open at the job's
// configured ET hour (default 9am; weekly also gates on its configured
// weekday, default Monday), and the runner's lastSuccessAt is the whole
// cursor — a success before today's send moment means we haven't sent today.
//
// No per-user lastDigestAt exists anywhere: `emailedAt IS NULL` inside the
// cadence window is the selection. Claim-before-send: the rows are marked
// emailed AND the digest is enqueued to the outbox in one transaction, so a
// crash can't leave rows unmarked (and re-sent); the outbox then owns delivery
// (retry + dead-letter) and its `digest:{freq}:{user}:{day}` key is a second
// guard against a same-day re-run.

import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";
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

/** Pure gate: has today's (ET) send moment arrived without a send since? */
export function shouldRunDigest(
  freq: DigestFrequency,
  lastSuccessAt: Date | null,
  now: Date,
  schedule: DigestSchedule,
): boolean {
  if (freq === "Weekly" && weekdayInZone(now) !== (schedule.sendWeekday ?? 1)) {
    return false;
  }
  const { year, month, day } = getZonedParts(now, APPLICATION_TZ);
  const sendMoment = zonedWallTimeUtc(
    year,
    month,
    day,
    schedule.sendHourEt,
    0,
    APPLICATION_TZ,
  );
  if (now < sendMoment) return false;
  return lastSuccessAt === null || lastSuccessAt < sendMoment;
}

function relativeTime(from: Date, to: Date): string {
  const hours = Math.max(0, Math.round((to.getTime() - from.getTime()) / 3_600_000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function renderDigestEmail(args: {
  firstName: string;
  now: Date;
  rows: {
    eventType: string;
    title: string;
    body: string | null;
    link: string | null;
    createdAt: Date;
  }[];
}): { subject: string; html: string } {
  const base = getFrontendUrl();
  const byLabel = new Map<string, typeof args.rows>();
  for (const row of args.rows) {
    const def: EventDef | undefined = EVENT_TYPES[row.eventType as keyof typeof EVENT_TYPES];
    const label = def?.label ?? "Other";
    const list = byLabel.get(label) ?? [];
    list.push(row);
    byLabel.set(label, list);
  }

  const sections = [...byLabel.entries()]
    .map(([label, rows]) => {
      const items = rows
        .map((r) => {
          const href = r.link
            ? /^https?:\/\//.test(r.link)
              ? r.link
              : `${base}${r.link.startsWith("/") ? "" : "/"}${r.link}`
            : null;
          const title = href
            ? `<a href="${href}" style="color:#18181b;">${r.title}</a>`
            : r.title;
          const snippet = r.body
            ? ` <span style="color:#71717a;">— ${r.body.slice(0, 120)}</span>`
            : "";
          return `<li style="margin:4px 0;"><strong>${title}</strong>${snippet} <span style="color:#a1a1aa;font-size:12px;">${relativeTime(r.createdAt, args.now)}</span></li>`;
        })
        .join("\n");
      return `<h3 style="margin:16px 0 4px;">${label}</h3>\n<ul style="margin:0;padding-left:20px;">${items}</ul>`;
    })
    .join("\n");

  const n = args.rows.length;
  return {
    subject: `Your DALI digest — ${n} update${n === 1 ? "" : "s"}`,
    html: [
      `<p>Hi ${args.firstName},</p>`,
      `<p>Here's what you haven't read on DALI OS:</p>`,
      sections,
      `<p style="margin-top:16px;"><a href="${base}" style="color:#18181b;">Open DALI OS</a> · <a href="${base}/settings/notifications" style="color:#71717a;">notification settings</a></p>`,
    ].join("\n"),
  };
}

export async function runDigest(freq: DigestFrequency, now: Date): Promise<JobResult> {
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
  const userIds = [...wantedByUser.keys()];

  const rows = await prisma.notification.findMany({
    where: {
      recipientUserId: { in: userIds },
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

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(matched.map((r) => r.recipientUserId))] } },
    select: {
      id: true,
      firstName: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
    },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const day = now.toISOString().slice(0, 10);
  const enqueuedIds: Array<string | null> = [];
  let sent = 0;
  for (const [userId, wanted] of wantedByUser) {
    const user = userById.get(userId);
    if (!user) continue;
    const to = user.daliEmail ?? user.dartmouthEmail ?? user.personalEmail;
    if (!to) continue;
    const userRows = matched.filter(
      (r) => r.recipientUserId === userId && wanted.has(r.eventType),
    );
    if (userRows.length === 0) continue; // no empty digests

    const { subject, html } = renderDigestEmail({
      firstName: user.firstName,
      now,
      rows: userRows,
    });
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
            dedupKey: `digest:${freq}:${userId}:${day}`,
            target: to,
            recipientUserId: userId,
            subject,
            bodyHtml: html,
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

export async function runDailyDigest({
  now,
  lastSuccessAt,
  settings,
}: JobContext): Promise<JobResult> {
  if (!shouldRunDigest("Daily", lastSuccessAt, now, { sendHourEt: settings.sendHourEt })) {
    return { items: 0, note: "not due" };
  }
  return runDigest("Daily", now);
}

export async function runWeeklyDigest({
  now,
  lastSuccessAt,
  settings,
}: JobContext): Promise<JobResult> {
  const schedule = { sendHourEt: settings.sendHourEt, sendWeekday: settings.sendWeekday };
  if (!shouldRunDigest("Weekly", lastSuccessAt, now, schedule)) {
    return { items: 0, note: "not due" };
  }
  return runDigest("Weekly", now);
}
