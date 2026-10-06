// "Email with partners@" data for the contact 360 page and the CRM Email
// tab (spec section 8): a partner contact's mail history with the shared
// partners@ inbox, grouped into threads. Reads only the headers-only
// MailMessageIndex — never the Gmail content itself. Mirrors
// app/hiring/lib/email-engagement.server.ts, scoped to a PartnerContact
// instead of a User and with no blinding (Partner CRM has no blind review).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { PARTNERS_FROM_EMAIL } from "~/lib/app-env";

export type PartnerEmailThread = {
  indexId: string;
  subject: string;
  firstAt: string;
  lastAt: string;
  messageCount: number;
  inbound: number;
  outbound: number;
};

/**
 * This contact's mail threads with `accountAddress` (the partners@ Shared
 * inbox), newest-first. Scoped to that one MailAccount so applicant mail and
 * partner mail never mix even if a contact's address were ever also linked
 * elsewhere.
 */
export async function getPartnerContactEmailThreads(
  contactId: string,
  opts: { accountAddress: string } = { accountAddress: PARTNERS_FROM_EMAIL },
): Promise<PartnerEmailThread[]> {
  const account = await prisma.mailAccount.findFirst({
    where: { kind: "Shared", address: opts.accountAddress.toLowerCase() },
    select: { id: true },
  });
  if (!account) return [];

  const rows = await prisma.mailMessageIndex.findMany({
    where: { accountId: account.id, linkedPartnerContactId: contactId },
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

  for (const row of rows) {
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

  return [...byThread.values()]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .map((t) => ({
      indexId: t.indexId,
      subject: t.subject,
      firstAt: t.firstAt.toISOString(),
      lastAt: t.lastAt.toISOString(),
      messageCount: t.inbound + t.outbound,
      inbound: t.inbound,
      outbound: t.outbound,
    }));
}

/**
 * Gate for opening the full Gmail thread behind a partner email row: the
 * viewer must be Core (no ownership, no blind review here — every Core
 * member may read every partner thread), and the row must actually be on the
 * partners@ account, not some other Shared inbox.
 */
export async function canViewPartnerThread(
  userId: string,
  indexId: string,
  request?: Request,
): Promise<boolean> {
  if (!(await isCore(userId, request))) return false;

  const row = await prisma.mailMessageIndex.findUnique({
    where: { id: indexId },
    select: { account: { select: { address: true } } },
  });
  if (!row) return false;

  return row.account.address.toLowerCase() === PARTNERS_FROM_EMAIL;
}
