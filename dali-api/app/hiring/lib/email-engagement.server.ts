// "Email with applications@" panel data for the hiring review pages: how much
// mail this applicant has exchanged with the applications@ inbox, grouped
// into threads. Reads only the headers-only MailMessageIndex — never the
// Gmail content itself. When blinded (reviewer still in blind review), the
// subject and thread pointer are stripped so the payload carries nothing a
// blinded reviewer couldn't already infer from the counts.

import { prisma } from "~/lib/db";
import { APPLICATIONS_FROM_EMAIL } from "~/lib/app-env";

export type EmailEngagement = {
  totals: { inbound: number; outbound: number; firstAt: string | null; lastAt: string | null };
  threads: {
    indexId: string | null;
    subject: string | null;
    firstAt: string;
    lastAt: string;
    inbound: number;
    outbound: number;
  }[];
};

export async function getApplicantEmailEngagement(
  userId: string,
  opts: { blinded: boolean; accountAddress?: string },
): Promise<EmailEngagement> {
  // Scoped to one shared inbox (applications@ by default) so a user who is
  // also linked on another inbox's index rows — e.g. a partner contact who
  // happens to share an address with a hiring applicant — never has that
  // other inbox's mail folded into this account's engagement.
  const accountAddress = opts.accountAddress ?? APPLICATIONS_FROM_EMAIL;
  const rows = await prisma.mailMessageIndex.findMany({
    where: { linkedUserId: userId, account: { address: { equals: accountAddress, mode: "insensitive" } } },
    orderBy: { sentAt: "asc" },
    select: { id: true, accountId: true, threadId: true, direction: true, subject: true, sentAt: true },
  });

  type ThreadAgg = {
    indexId: string;
    subject: string;
    firstAt: Date;
    lastAt: Date;
    inbound: number;
    outbound: number;
  };
  const byThread = new Map<string, ThreadAgg>();
  let inbound = 0;
  let outbound = 0;

  for (const row of rows) {
    if (row.direction === "Inbound") inbound++;
    else outbound++;

    const key = `${row.accountId}~${row.threadId}`;
    const existing = byThread.get(key);
    if (existing) {
      existing.indexId = row.id; // rows arrive oldest-first, so this ends up newest
      existing.subject = row.subject || existing.subject;
      existing.lastAt = row.sentAt;
      if (row.direction === "Inbound") existing.inbound++;
      else existing.outbound++;
    } else {
      byThread.set(key, {
        indexId: row.id,
        subject: row.subject,
        firstAt: row.sentAt,
        lastAt: row.sentAt,
        inbound: row.direction === "Inbound" ? 1 : 0,
        outbound: row.direction === "Outbound" ? 1 : 0,
      });
    }
  }

  const threads = [...byThread.values()]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .map((t) => ({
      indexId: opts.blinded ? null : t.indexId,
      subject: opts.blinded ? null : t.subject,
      firstAt: t.firstAt.toISOString(),
      lastAt: t.lastAt.toISOString(),
      inbound: t.inbound,
      outbound: t.outbound,
    }));

  return {
    totals: {
      inbound,
      outbound,
      firstAt: rows[0]?.sentAt.toISOString() ?? null,
      lastAt: rows.at(-1)?.sentAt.toISOString() ?? null,
    },
    threads,
  };
}
