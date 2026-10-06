// Builds and queries the applicant-email index (MailMessageIndex): a thin,
// headers-only row per Gmail message in the applications@ Shared inbox,
// auto-linked to the User it was exchanged with by address. Mail content
// stays in Gmail — this table only ever records who/when/subject.

import { prisma } from "~/lib/db";
import type { EmailSendPurpose } from "~/generated/prisma/client";
import { findUserIdsByAddresses } from "~/lib/user-email.server";
import { PARTNERS_FROM_EMAIL } from "~/lib/app-env";
import { parseAddressList } from "~/email/lib/address-list";
import { senderAddress } from "~/email/lib/format";
import { getMailboxToken, MailboxError, type MessageMeta } from "~/email/lib/gmail-mailbox.server";
import { getMailboxReader, noteSenderHealth } from "~/lib/gmail-integration";
import { GoogleOAuthError, refreshGoogleToken } from "~/lib/google-oauth";

const SUBJECT_MAX_LENGTH = 500;

export async function getSharedInboxAccount(address: string) {
  const account = await prisma.mailAccount.findFirst({
    where: { kind: "Shared", address: address.toLowerCase() },
    include: {
      connections: {
        orderBy: [{ syncError: { sort: "asc", nulls: "first" } }, { connectedAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!account) return null;
  const connection = account.connections[0] ?? null;
  return { account, connection };
}

// Access tokens minted from the Hiring integration's refresh token, kept
// until shortly before expiry so the thread modal and the index job don't
// round-trip Google on every call.
const readerTokens = new Map<string, { token: string; expiresAt: number }>();
const READER_REFRESH_BUFFER_MS = 60_000;

async function readerAccessToken(reader: { id: string; refreshToken: string }): Promise<string> {
  const cached = readerTokens.get(reader.id);
  if (cached && cached.expiresAt > Date.now() + READER_REFRESH_BUFFER_MS) return cached.token;
  let data;
  try {
    data = await refreshGoogleToken({
      refreshToken: reader.refreshToken,
      clientId: process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!,
    });
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      await noteSenderHealth(reader.id, "Sign-in expired. Reconnect in Admin → Email senders.");
      throw new MailboxError("Hiring Gmail sign-in expired", err.upstreamStatus);
    }
    throw err;
  }
  readerTokens.set(reader.id, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 0) * 1000,
  });
  return data.access_token;
}

/**
 * A token that can read the Shared inbox at `address`, plus the MailAccount
 * the index rows hang off. The `purpose` Gmail integration (default Hiring,
 * matching every caller before Partners existed) is preferred when it was
 * connected with the read scope; otherwise the healthiest member connection
 * is borrowed. `source` is a short label for job notes.
 */
export async function getSharedInboxToken(
  address: string,
  purpose: EmailSendPurpose = "Hiring",
): Promise<{ token: string; accountId: string; address: string; source: string }> {
  const found = await getSharedInboxAccount(address);
  if (!found) {
    throw new MailboxError(`No Shared inbox for ${address}. Add it in Admin → Email.`);
  }
  const { account, connection } = found;

  const reader = await getMailboxReader(account.address, purpose);
  if (reader) {
    const token = await readerAccessToken(reader);
    return { token, accountId: account.id, address: account.address, source: `the ${purpose} Gmail integration` };
  }

  if (!connection) {
    throw new MailboxError(
      `Nobody has connected ${address} yet, and the ${purpose} Gmail integration has no inbox read access. Reconnect it in Admin → Email senders.`,
    );
  }
  const token = await getMailboxToken({
    id: account.id,
    oauthTokens: connection.oauthTokens,
    connectionId: connection.id,
  });
  return {
    token,
    accountId: account.id,
    address: account.address,
    source: `${connection.userId}'s connection`,
  };
}

export function classifyDirection(
  meta: { labelIds: string[]; from: string },
  inboxAddress: string,
): "Inbound" | "Outbound" {
  if (meta.labelIds.includes("SENT")) return "Outbound";
  return senderAddress(meta.from).toLowerCase() === inboxAddress.toLowerCase() ? "Outbound" : "Inbound";
}

// Who's on the other end of this message, lowercase and deduped, minus the
// inbox's own address.
export function counterpartAddresses(
  direction: "Inbound" | "Outbound",
  meta: { from: string; to: string; cc: string },
  inboxAddress: string,
): string[] {
  const inbox = inboxAddress.toLowerCase();
  const raw = direction === "Inbound" ? [meta.from] : [meta.to, meta.cc];
  const addresses = raw.flatMap((h) => parseAddressList(h ?? ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addresses) {
    if (a === inbox || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

export type IndexableMessage = {
  id: string;
  threadId: string;
  direction: "Inbound" | "Outbound";
  subject: string;
  date: string;
  from: string;
  to: string;
  cc: string;
};

/**
 * Index a batch of messages for one Shared inbox: resolve each message's
 * counterpart address(es) to a User (or, for the partners@ inbox, a
 * PartnerContact), inherit a thread's Manual link when one exists, and write
 * the rows (skipping any already indexed). Returns how many new rows were
 * created.
 */
export async function indexMessages(args: {
  accountId: string;
  inboxAddress: string;
  metas: IndexableMessage[];
  /** Forces the PartnerContact lookup even off the partners@ address. */
  linkPartnerContacts?: boolean;
}): Promise<number> {
  const { accountId, inboxAddress, metas } = args;
  if (metas.length === 0) return 0;
  const linkPartnerContacts =
    args.linkPartnerContacts ?? inboxAddress.toLowerCase() === PARTNERS_FROM_EMAIL;

  const allCounterparts = new Set<string>();
  for (const m of metas) {
    for (const a of counterpartAddresses(m.direction, m, inboxAddress)) allCounterparts.add(a);
  }
  const resolved = await findUserIdsByAddresses([...allCounterparts]);
  const resolvedContacts = linkPartnerContacts
    ? await findPartnerContactIdsByAddresses([...allCounterparts])
    : new Map<string, string>();

  const threadIds = [...new Set(metas.map((m) => m.threadId))];
  // Every row in a thread shares the same manually-set value (setThreadLink
  // overwrites them all together), so which one `distinct` keeps doesn't matter.
  const manualLinks = await prisma.mailMessageIndex.findMany({
    where: { accountId, threadId: { in: threadIds }, linkSource: "Manual" },
    distinct: ["threadId"],
    select: { threadId: true, linkedUserId: true, linkedPartnerContactId: true },
  });
  const manualByThread = new Map(
    manualLinks.map((m) => [m.threadId, { userId: m.linkedUserId, partnerContactId: m.linkedPartnerContactId }]),
  );

  const data = metas.map((m) => {
    const inheritedManual = manualByThread.get(m.threadId);
    let linkedUserId: string | null = null;
    let linkedPartnerContactId: string | null = null;
    let linkSource: "None" | "Auto" | "Manual" = "None";
    if (inheritedManual !== undefined) {
      linkedUserId = inheritedManual.userId;
      linkedPartnerContactId = inheritedManual.partnerContactId;
      linkSource = "Manual";
    } else {
      for (const a of counterpartAddresses(m.direction, m, inboxAddress)) {
        const userId = resolved.get(a);
        if (userId) {
          linkedUserId = userId;
          linkSource = "Auto";
          break;
        }
      }
      if (linkSource === "None" && linkPartnerContacts) {
        for (const a of counterpartAddresses(m.direction, m, inboxAddress)) {
          const partnerContactId = resolvedContacts.get(a);
          if (partnerContactId) {
            linkedPartnerContactId = partnerContactId;
            linkSource = "Auto";
            break;
          }
        }
      }
    }
    return {
      accountId,
      gmailMessageId: m.id,
      threadId: m.threadId,
      direction: m.direction,
      subject: m.subject.slice(0, SUBJECT_MAX_LENGTH),
      sentAt: new Date(m.date),
      fromAddress: senderAddress(m.from).toLowerCase(),
      toAddresses: parseAddressList(m.to ?? ""),
      linkedUserId,
      linkedPartnerContactId,
      linkSource,
    };
  });

  const result = await prisma.mailMessageIndex.createMany({ data, skipDuplicates: true });
  return result.count;
}

// PartnerContact.email is stored normalized lowercase (the natural key for
// matching inbound mail), and counterpartAddresses already lowercases, so
// this is a direct equality lookup — no case-insensitive query needed.
async function findPartnerContactIdsByAddresses(addresses: string[]): Promise<Map<string, string>> {
  if (addresses.length === 0) return new Map();
  const rows = await prisma.partnerContact.findMany({
    where: { email: { in: addresses } },
    select: { id: true, email: true },
  });
  return new Map(rows.map((r) => [r.email, r.id]));
}

export type ThreadLinkTarget = { userId: string } | { partnerContactId: string } | null;

export async function setThreadLink(args: {
  accountId: string;
  threadId: string;
  target: ThreadLinkTarget;
  byUserId: string;
  now: Date;
}): Promise<void> {
  const { target } = args;
  await prisma.mailMessageIndex.updateMany({
    where: { accountId: args.accountId, threadId: args.threadId },
    data: {
      linkedUserId: target && "userId" in target ? target.userId : null,
      linkedPartnerContactId: target && "partnerContactId" in target ? target.partnerContactId : null,
      linkSource: "Manual",
      linkedById: args.byUserId,
      linkedAt: args.now,
    },
  });
}

export async function getThreadLink(
  accountId: string,
  threadId: string,
): Promise<(({ userId: string } | { partnerContactId: string }) & { source: "Auto" | "Manual" }) | null> {
  const row = await prisma.mailMessageIndex.findFirst({
    where: { accountId, threadId },
    orderBy: { sentAt: "desc" },
    select: { linkedUserId: true, linkedPartnerContactId: true, linkSource: true },
  });
  if (!row || row.linkSource === "None") return null;
  if (row.linkedUserId) return { userId: row.linkedUserId, source: row.linkSource };
  if (row.linkedPartnerContactId) return { partnerContactId: row.linkedPartnerContactId, source: row.linkSource };
  return null;
}
