import { prisma } from "~/lib/db.server";
import { resolveGroupMembers } from "~/lib/groups.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { notify } from "~/lib/notify.server";
import type { JobContext, JobResult } from "~/jobs/registry";
import { canImportStatement, type ExpenseViewer } from "./access";
import { ExpenseError } from "./errors";
import { formatCents, parseMoneyToCents } from "./money";

const DAY_MS = 86_400_000;
export const UNPAID_DEFAULT_DAYS = 14;
const UNPAID_CAP = 200;

export function receiptRequestLink(chargeId: string): string {
  return `/expenses?charge=${chargeId}`;
}

export async function requestReceipt(actor: ExpenseViewer, chargeId: string, now: Date = new Date()): Promise<{ notified: number }> {
  const charge = await prisma.cardStatementCharge.findUnique({
    where: { id: chargeId },
    select: {
      id: true,
      merchant: true,
      amount: true,
      cardId: true,
      expense: { select: { id: true } },
      card: { select: { id: true, nickname: true, ownerId: true, holderIds: true, holderGroupIds: true } },
    },
  });
  if (!charge || !canImportStatement(actor, charge.cardId)) throw new ExpenseError("not_found", "That charge wasn't found.");
  if (charge.expense) throw new ExpenseError("invalid", "That charge already has an expense.");

  const link = receiptRequestLink(chargeId);
  const recent = await prisma.notification.findFirst({
    where: { eventType: "expense.needs_receipt", link, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
    select: { id: true },
  });
  if (recent) return { notified: 0 };

  const groupMembers = (await Promise.all(charge.card.holderGroupIds.map(resolveGroupMembers))).flat();
  const recipients = [...new Set([charge.card.ownerId, ...charge.card.holderIds, ...groupMembers])].filter((id) => id !== actor.userId);
  if (recipients.length === 0) return { notified: 0 };

  const cents = parseMoneyToCents(charge.amount.toString());
  const amount = cents === null ? "" : ` (${formatCents(cents)})`;
  await notify({
    eventType: "expense.needs_receipt",
    createdByUserId: actor.userId,
    message: {
      title: `Receipt needed: ${charge.merchant}${amount}`,
      body: `A charge on ${charge.card.nickname} has no receipt yet. Upload one or say why there isn't one.`,
      link,
      dedupKey: `expense-needs-receipt:${chargeId}:${Math.floor(now.getTime() / DAY_MS)}`,
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
  return { notified: recipients.length };
}

export async function runUnpaidExpenseReminders({ now, settings }: JobContext): Promise<JobResult> {
  if (!(await isFeatureEnabledForEveryone("expenses"))) return { items: 0, note: "expenses flag is off" };

  const days = Math.max(1, Math.floor(settings.unpaidAfterDays ?? UNPAID_DEFAULT_DAYS));
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const expenses = await prisma.expense.findMany({
    where: { status: "APPROVED", paidWith: "OWN_CARD", decidedAt: { lte: cutoff } },
    select: { id: true, merchant: true, total: true, decidedAt: true, submitter: { select: { firstName: true, lastName: true } } },
    orderBy: { decidedAt: "asc" },
    take: UNPAID_CAP,
  });
  if (expenses.length === 0) return { items: 0 };

  const staff = await prisma.adminMembership.findMany({ where: { isStaff: true }, select: { userId: true } });
  if (staff.length === 0) return { items: 0, note: "no staff to notify" };
  const recipients = staff.map((s) => ({ userId: s.userId }));

  let items = 0;
  for (const e of expenses) {
    const waited = Math.floor((now.getTime() - (e.decidedAt as Date).getTime()) / DAY_MS);
    const interval = Math.floor(waited / days);
    const cents = e.total === null ? null : parseMoneyToCents(e.total.toString());
    const who = `${e.submitter.firstName} ${e.submitter.lastName}`.trim();
    const res = await notify({
      eventType: "expense.unpaid_reminder",
      message: {
        title: `Not paid back yet: ${[e.merchant ?? "Expense", cents === null ? null : formatCents(cents)].filter(Boolean).join(" ")}`,
        body: `${who}'s approved expense has been waiting ${waited} days for payment.`,
        link: `/expenses?expense=${e.id}`,
        dedupKey: `expense-unpaid:${e.id}:${interval}`,
      },
      recipients,
    });
    if (res.inApp > 0) items += 1;
  }
  return { items };
}
