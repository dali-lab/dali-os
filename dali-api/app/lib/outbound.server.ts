// Outbound Message Layer — the transactional outbox every email / Slack send
// flows through. Producers (notify(), the digest, the transactional per-feature
// pipelines) call enqueueOutbound() instead of sendEmail()/sendDm()/postMessage()
// directly. The enqueue is the idempotency claim: a re-fired producer collides on
// the unique (channel, dedupKey) and no-ops instead of sending twice.
//
// Delivery: drainNow(ids) runs a best-effort pass right after enqueue for low
// latency (interactive flows send within the request); the single-leased
// outbound-drain job (runOutboundDrain) sweeps the rest — claiming rows with a
// CAS lock, retrying transient failures with exponential backoff, deferring
// over-cap sends to the next UTC day, and dead-lettering exhausted messages for
// an operator to inspect in Admin → Communications.
//
// See specs/communication-idempotency.md.

import { prisma } from "~/lib/db";
import { sendEmail, type EmailAttachment } from "~/lib/gmail";
import { getSender, noteSenderHealth } from "~/lib/gmail-integration";
import { slackConfigured, sendDm, postMessage } from "~/slack/lib/slack-client";
import { getAppEnv } from "~/lib/app-env";
import { Prisma, type EmailSendPurpose } from "~/generated/prisma/client";
import type { JobContext, JobResult } from "~/jobs/registry";

export type OutboundChannel = "email" | "slack_dm" | "slack_channel";

export type EnqueueOutboundArgs = {
  channel: OutboundChannel;
  // Idempotency claim. Null/undefined → always sends (NULLs distinct in the
  // unique index). Use a stable `{feature}.{action}:{entityId}:{recipientRef}`
  // for once-ever sends; omit (or pass a fresh value) to force a re-send.
  dedupKey?: string | null;
  // Email only: which Gmail identity sends this (resolved at drain time).
  purpose?: EmailSendPurpose | null;
  // Rendered destination: email address(es) | Slack user id | Slack channel id.
  target: string;
  recipientUserId?: string | null;
  // The in-app Notification this delivers for (notify() only) — the drain stamps
  // its emailedAt / slackDmAt on success.
  notificationId?: string | null;
  subject?: string | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
  slackText?: string | null;
  ics?: string | null;
  attachments?: EmailAttachment[] | null;
  eventType?: string | null;
  createdByUserId?: string | null;
};

export type EnqueueResult = { id: string | null; deduped: boolean };

// Structural client type so enqueueOutbound can run on either the global prisma
// or a $transaction client — letting a producer write the outbound row inside
// its domain transaction (the message is enqueued iff the domain change commits).
type OutboundDb = { outboundMessage: Pick<typeof prisma.outboundMessage, "create"> };

export type DrainConfig = {
  batchSize: number;
  maxConcurrency: number;
  maxAttempts: number;
  baseBackoffSeconds: number;
  lockSeconds: number;
};

const DEFAULT_DRAIN: DrainConfig = {
  batchSize: 50,
  maxConcurrency: 5,
  maxAttempts: 6,
  baseBackoffSeconds: 60,
  lockSeconds: 120,
};

// Slack is prod-only: the staging DB is a prod snapshot, so real Slack ids live
// there and a staging send would reach real people. Mirrors notify.server.ts.
function slackAllowed(): boolean {
  return getAppEnv() === "prod" || process.env.NOTIFY_SLACK_DM_OVERRIDE === "1";
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

type StoredAttachment = { filename: string; mimeType: string; contentBase64: string };

function encodeAttachments(atts?: EmailAttachment[] | null): StoredAttachment[] | undefined {
  if (!atts || atts.length === 0) return undefined;
  return atts.map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
    contentBase64: a.content.toString("base64"),
  }));
}

function decodeAttachments(json: Prisma.JsonValue | null): EmailAttachment[] | undefined {
  if (!Array.isArray(json) || json.length === 0) return undefined;
  return (json as unknown as StoredAttachment[]).map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
    content: Buffer.from(a.contentBase64, "base64"),
  }));
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextUtcMidnight(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

/**
 * Claim-then-send: writes the outbound row. Returns the id when newly enqueued,
 * or { deduped: true } when a keyed send already claimed this (channel, dedupKey).
 */
export async function enqueueOutbound(
  args: EnqueueOutboundArgs,
  db: OutboundDb = prisma,
): Promise<EnqueueResult> {
  try {
    const row = await db.outboundMessage.create({
      data: {
        channel: args.channel,
        dedupKey: args.dedupKey ?? null,
        purpose: args.purpose ?? null,
        target: args.target,
        recipientUserId: args.recipientUserId ?? null,
        notificationId: args.notificationId ?? null,
        subject: args.subject ?? null,
        bodyHtml: args.bodyHtml ?? null,
        bodyText: args.bodyText ?? null,
        slackText: args.slackText ?? null,
        ics: args.ics ?? null,
        attachments: encodeAttachments(args.attachments) ?? Prisma.DbNull,
        eventType: args.eventType ?? null,
        createdByUserId: args.createdByUserId ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, deduped: false };
  } catch (err) {
    if (args.dedupKey && isUniqueViolation(err)) return { id: null, deduped: true };
    throw err;
  }
}

/**
 * Best-effort inline drain of specific rows, run right after enqueue so
 * interactive sends go out within the request. Never throws — anything left
 * Pending is swept by the tick drain.
 */
export async function drainNow(ids: Array<string | null>): Promise<void> {
  const clean = ids.filter((id): id is string => Boolean(id));
  if (clean.length === 0) return;
  try {
    await drainRows(clean, DEFAULT_DRAIN);
  } catch (err) {
    console.error("[outbound] inline drain failed:", err);
  }
}

/** Job handler: sweep all due Pending / stale-Sending rows. */
export async function runOutboundDrain(ctx: JobContext): Promise<JobResult> {
  const s = ctx.settings;
  const cfg: DrainConfig = {
    batchSize: s.batchSize ?? DEFAULT_DRAIN.batchSize,
    maxConcurrency: s.maxConcurrency ?? DEFAULT_DRAIN.maxConcurrency,
    maxAttempts: s.maxAttempts ?? DEFAULT_DRAIN.maxAttempts,
    baseBackoffSeconds: s.baseBackoffSeconds ?? DEFAULT_DRAIN.baseBackoffSeconds,
    lockSeconds: s.lockSeconds ?? DEFAULT_DRAIN.lockSeconds,
  };
  const sent = await drainRows(null, cfg);
  return { items: sent };
}

async function drainRows(ids: string[] | null, cfg: DrainConfig): Promise<number> {
  const now = new Date();
  const candidates = await prisma.outboundMessage.findMany({
    where: {
      // Pending is due work; a stale "Sending" (past its lock) is a crashed
      // send we reclaim.
      status: { in: ["Pending", "Sending"] },
      nextAttemptAt: { lte: now },
      ...(ids ? { id: { in: ids } } : {}),
    },
    orderBy: { nextAttemptAt: "asc" },
    take: ids ? undefined : cfg.batchSize,
    select: { id: true },
  });
  if (candidates.length === 0) return 0;

  const queue = candidates.map((c) => c.id);
  let sent = 0;
  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      if (await processOne(id, cfg)) sent += 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(cfg.maxConcurrency, queue.length) }, worker),
  );
  return sent;
}

async function processOne(id: string, cfg: DrainConfig): Promise<boolean> {
  const now = new Date();
  // Atomic CAS claim: the WHERE re-checks status + due, so an inline attempt and
  // the tick can't both own a row. Setting nextAttemptAt into the future locks it.
  const claim = await prisma.outboundMessage.updateMany({
    where: { id, status: { in: ["Pending", "Sending"] }, nextAttemptAt: { lte: now } },
    data: { status: "Sending", nextAttemptAt: new Date(now.getTime() + cfg.lockSeconds * 1000) },
  });
  if (claim.count !== 1) return false; // lost the race, or not due

  const row = await prisma.outboundMessage.findUnique({ where: { id } });
  if (!row) return false;

  try {
    const outcome = await sendOne(row);
    if (outcome.cancel) {
      await prisma.outboundMessage.update({
        where: { id },
        data: { status: "Canceled", lastError: outcome.reason ?? "canceled" },
      });
      return false;
    }
    if (outcome.deferUntil) {
      await prisma.outboundMessage.update({
        where: { id },
        data: { status: "Pending", nextAttemptAt: outcome.deferUntil, lastError: outcome.reason ?? null },
      });
      return false;
    }
    await prisma.outboundMessage.update({
      where: { id },
      data: {
        status: "Sent",
        sentAt: new Date(),
        senderId: outcome.senderId ?? row.senderId,
        lastError: null,
      },
    });
    await markNotificationDelivered(row.notificationId, row.channel);
    return true;
  } catch (err) {
    await handleFailure(row.id, row.attempts, err, cfg);
    return false;
  }
}

type SendOutcome = {
  senderId?: string;
  deferUntil?: Date;
  cancel?: boolean;
  reason?: string;
};

async function sendOne(row: {
  channel: string;
  purpose: string | null;
  target: string;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  slackText: string | null;
  ics: string | null;
  attachments: Prisma.JsonValue | null;
}): Promise<SendOutcome> {
  if (row.channel === "email") {
    const purpose = (row.purpose ?? "General") as EmailSendPurpose;
    const sender = await getSender(purpose);
    if (!sender) throw new Error(`no Gmail sender for purpose ${purpose}`);

    const cap = await senderCap(sender.id);
    if (cap != null && (await usageToday(sender.id)) >= cap) {
      return { deferUntil: nextUtcMidnight(new Date()), reason: `sender ${sender.id} at daily cap (${cap})` };
    }

    try {
      await sendEmail({
        refreshToken: sender.refreshToken,
        from: sender.sendAsEmail,
        to: row.target,
        subject: row.subject ?? "",
        html: row.bodyHtml ?? "",
        ics: row.ics ?? undefined,
        attachments: decodeAttachments(row.attachments),
      });
    } catch (err) {
      await noteSenderHealth(sender.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
    await incrementUsage(sender.id);
    await noteSenderHealth(sender.id, null);
    return { senderId: sender.id };
  }

  if (row.channel === "slack_dm" || row.channel === "slack_channel") {
    // Defense-in-depth: never reach real Slack ids from dev/staging even if a
    // producer enqueued one. Cancel rather than retry forever.
    if (!slackConfigured() || !slackAllowed()) {
      return { cancel: true, reason: `slack not allowed in ${getAppEnv()}` };
    }
    const text = row.slackText ?? row.bodyText ?? row.subject ?? "";
    if (row.channel === "slack_dm") await sendDm(row.target, text);
    else await postMessage(row.target, text);
    return {};
  }

  throw new Error(`unknown outbound channel: ${row.channel}`);
}

async function handleFailure(
  id: string,
  priorAttempts: number,
  err: unknown,
  cfg: DrainConfig,
): Promise<void> {
  const attempts = priorAttempts + 1;
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  if (attempts >= cfg.maxAttempts) {
    await prisma.outboundMessage.update({
      where: { id },
      data: { status: "Dead", attempts, lastError: msg },
    });
    return;
  }
  const backoffMs = cfg.baseBackoffSeconds * 1000 * 2 ** (attempts - 1);
  await prisma.outboundMessage.update({
    where: { id },
    data: {
      status: "Pending",
      attempts,
      nextAttemptAt: new Date(Date.now() + backoffMs),
      lastError: msg,
    },
  });
}

async function markNotificationDelivered(
  notificationId: string | null,
  channel: string,
): Promise<void> {
  if (!notificationId) return;
  const field =
    channel === "email" ? "emailedAt" : channel === "slack_dm" ? "slackDmAt" : null;
  if (!field) return;
  await prisma.notification
    .update({ where: { id: notificationId }, data: { [field]: new Date() } })
    .catch(() => {}); // best-effort: the row may have been deleted by retention
}

async function senderCap(senderId: string): Promise<number | null> {
  const g = await prisma.gmailIntegration.findUnique({
    where: { id: senderId },
    select: { dailyCap: true },
  });
  return g?.dailyCap ?? null;
}

async function usageToday(senderId: string): Promise<number> {
  const u = await prisma.senderDailyUsage.findUnique({
    where: { senderId_day: { senderId, day: utcDay(new Date()) } },
    select: { count: true },
  });
  return u?.count ?? 0;
}

async function incrementUsage(senderId: string): Promise<void> {
  const day = utcDay(new Date());
  await prisma.senderDailyUsage.upsert({
    where: { senderId_day: { senderId, day } },
    create: { senderId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
}
