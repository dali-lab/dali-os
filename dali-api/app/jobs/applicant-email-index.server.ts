// Indexes the applications@ Shared inbox (headers only) into
// MailMessageIndex, auto-linking each message to the User it was exchanged
// with by address. Mail content never leaves Gmail.
//
// Backfill vs. incremental: while MailAccount.indexBackfilledAt is unset, the
// search window is the full `backfillDays` lookback every run; once the
// backlog has been fully walked (missing <= maxMessagesPerRun in one run)
// indexBackfilledAt is stamped and later runs only look back
// `overlapHours` past the newest indexed message, to absorb any
// just-barely-missed mail without re-scanning everything.
//
// Per-run work is capped at `maxMessagesPerRun`: Gmail lists newest-first, so
// the OLDEST of this run's missing ids are processed first (slice(-cap)) —
// backfill fills in the earliest gaps before the most recent ones, making
// steady forward progress across runs instead of thrashing on new mail.

import { prisma } from "~/lib/db";
import type { JobContext, JobResult } from "~/jobs/registry";
import { APPLICATIONS_FROM_EMAIL } from "~/lib/app-env";
import { getMessageMetadata, listMessageIds, MailboxError } from "~/email/lib/gmail-mailbox.server";
import {
  classifyDirection,
  getSharedInboxAccount,
  getSharedInboxToken,
  indexMessages,
  type IndexableMessage,
} from "~/email/lib/mail-index.server";

const MAX_PAGES = 10;
const PAGE_SIZE = 500;
const EXISTING_CHUNK_SIZE = 500;
const METADATA_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function runApplicantEmailIndex({ now, settings }: JobContext): Promise<JobResult> {
  const address = APPLICATIONS_FROM_EMAIL;

  const found = await getSharedInboxAccount(address);
  if (!found) {
    return { items: 0, note: `No Shared inbox for ${address}. Add it in Admin → Email.` };
  }
  const { account } = found;

  let token: string;
  let source: string;
  try {
    const got = await getSharedInboxToken(address);
    token = got.token;
    source = got.source;
  } catch (err) {
    if (err instanceof MailboxError) return { items: 0, note: err.message };
    throw err;
  }

  const { backfillDays, maxMessagesPerRun, overlapHours } = settings;

  let afterSeconds: number;
  if (account.indexBackfilledAt == null) {
    afterSeconds = Math.floor((now.getTime() - backfillDays * 86_400_000) / 1000);
  } else {
    const maxRow = await prisma.mailMessageIndex.aggregate({
      where: { accountId: account.id },
      _max: { sentAt: true },
    });
    afterSeconds = maxRow._max.sentAt
      ? Math.floor((maxRow._max.sentAt.getTime() - overlapHours * 3_600_000) / 1000)
      : Math.floor((now.getTime() - backfillDays * 86_400_000) / 1000);
  }
  const query = `after:${afterSeconds} -in:chats`;

  const listed: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listMessageIds(token, { query, max: PAGE_SIZE, pageToken });
    listed.push(...result.messages);
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }

  const existingIds = new Set<string>();
  for (let i = 0; i < listed.length; i += EXISTING_CHUNK_SIZE) {
    const chunk = listed.slice(i, i + EXISTING_CHUNK_SIZE).map((m) => m.id);
    const rows = await prisma.mailMessageIndex.findMany({
      where: { accountId: account.id, gmailMessageId: { in: chunk } },
      select: { gmailMessageId: true },
    });
    for (const r of rows) existingIds.add(r.gmailMessageId);
  }

  const missing = listed.filter((m) => !existingIds.has(m.id));
  const toProcess = missing.length > maxMessagesPerRun ? missing.slice(-maxMessagesPerRun) : missing;

  const metas = await mapWithConcurrency(toProcess, METADATA_CONCURRENCY, (m) =>
    getMessageMetadata(token, m.id),
  );

  const indexable: IndexableMessage[] = metas.map((meta) => ({
    id: meta.id,
    threadId: meta.threadId,
    direction: classifyDirection(meta, address),
    subject: meta.subject,
    date: meta.date,
    from: meta.from,
    to: meta.to,
    cc: meta.cc,
  }));

  const created = await indexMessages({ accountId: account.id, inboxAddress: address, metas: indexable });

  const drained = missing.length <= maxMessagesPerRun;
  if (drained && account.indexBackfilledAt == null) {
    await prisma.mailAccount.update({ where: { id: account.id }, data: { indexBackfilledAt: now } });
  }

  const note = drained
    ? `indexed ${created} via ${source}; backfill complete`
    : `indexed ${created} via ${source}; backfill remaining ${missing.length - toProcess.length}`;

  return { items: created, note };
}
