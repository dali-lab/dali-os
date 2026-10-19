// Applicant interest, read from the headers-only MailMessageIndex: how often
// the applicant wrote to the applications@ inbox. Our own mail (mostly
// automated) and their auto-replies don't count. When blinded, the subject and
// thread pointer are stripped so the payload carries nothing a blinded
// reviewer couldn't already infer from the counts.

import { prisma } from "~/lib/db";

export type EngagementSummary = {
  fromThem: number;
  threadsStarted: number;
  lastFromThemAt: string | null;
};

export type EmailEngagement = {
  totals: EngagementSummary;
  threads: {
    indexId: string | null;
    subject: string | null;
    firstAt: string;
    lastAt: string;
    messages: number;
    fromThem: number;
    startedByThem: boolean;
  }[];
};

type IndexRow = {
  id: string;
  accountId: string;
  threadId: string;
  direction: "Inbound" | "Outbound";
  autoReply: boolean | null;
  subject: string;
  sentAt: Date;
};

type ThreadAgg = {
  indexId: string;
  subject: string;
  firstAt: Date;
  lastAt: Date;
  messages: number;
  fromThem: number;
  lastFromThemAt: Date | null;
  startedByThem: boolean;
};

const isFromThem = (row: Pick<IndexRow, "direction" | "autoReply">) =>
  row.direction === "Inbound" && row.autoReply !== true;

// Rows must arrive oldest-first.
function threadsWithReplies(rows: IndexRow[]): ThreadAgg[] {
  const byThread = new Map<string, ThreadAgg>();
  for (const row of rows) {
    const key = `${row.accountId}~${row.threadId}`;
    const fromThem = isFromThem(row);
    const t = byThread.get(key);
    if (t) {
      t.indexId = row.id;
      t.subject = row.subject || t.subject;
      t.lastAt = row.sentAt;
      t.messages++;
      if (fromThem) {
        t.fromThem++;
        t.lastFromThemAt = row.sentAt;
      }
    } else {
      byThread.set(key, {
        indexId: row.id,
        subject: row.subject,
        firstAt: row.sentAt,
        lastAt: row.sentAt,
        messages: 1,
        fromThem: fromThem ? 1 : 0,
        lastFromThemAt: fromThem ? row.sentAt : null,
        startedByThem: fromThem,
      });
    }
  }
  return [...byThread.values()].filter((t) => t.fromThem > 0);
}

function summarize(threads: ThreadAgg[]): EngagementSummary {
  let last: Date | null = null;
  for (const t of threads) {
    if (t.lastFromThemAt && (!last || t.lastFromThemAt > last)) last = t.lastFromThemAt;
  }
  return {
    fromThem: threads.reduce((n, t) => n + t.fromThem, 0),
    threadsStarted: threads.filter((t) => t.startedByThem).length,
    lastFromThemAt: last?.toISOString() ?? null,
  };
}

const ROW_SELECT = {
  id: true,
  accountId: true,
  threadId: true,
  direction: true,
  autoReply: true,
  subject: true,
  sentAt: true,
} as const;

export async function getApplicantEmailEngagement(
  userId: string,
  opts: { blinded: boolean },
): Promise<EmailEngagement> {
  const rows = await prisma.mailMessageIndex.findMany({
    where: { linkedUserId: userId },
    orderBy: { sentAt: "asc" },
    select: ROW_SELECT,
  });
  const threads = threadsWithReplies(rows);

  return {
    totals: summarize(threads),
    threads: threads
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .map((t) => ({
        indexId: opts.blinded ? null : t.indexId,
        subject: opts.blinded ? null : t.subject,
        firstAt: t.firstAt.toISOString(),
        lastAt: t.lastAt.toISOString(),
        messages: t.messages,
        fromThem: t.fromThem,
        startedByThem: t.startedByThem,
      })),
  };
}

// Only users who wrote to us get an entry.
export async function getEngagementSummaries(userIds: string[]): Promise<Map<string, EngagementSummary>> {
  const out = new Map<string, EngagementSummary>();
  if (userIds.length === 0) return out;

  const rows = await prisma.mailMessageIndex.findMany({
    where: { linkedUserId: { in: [...new Set(userIds)] } },
    orderBy: { sentAt: "asc" },
    select: { ...ROW_SELECT, linkedUserId: true },
  });
  const byUser = new Map<string, IndexRow[]>();
  for (const row of rows) {
    if (!row.linkedUserId) continue;
    const list = byUser.get(row.linkedUserId);
    if (list) list.push(row);
    else byUser.set(row.linkedUserId, [row]);
  }
  for (const [userId, userRows] of byUser) {
    const summary = summarize(threadsWithReplies(userRows));
    if (summary.fromThem > 0) out.set(userId, summary);
  }
  return out;
}
