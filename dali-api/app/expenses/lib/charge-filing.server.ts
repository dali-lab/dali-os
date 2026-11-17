import { prisma } from "~/lib/db.server";
import { canFileOnCard, type ExpenseViewer } from "./access";
import { ExpenseError } from "./errors";
import { parseMoneyToCents } from "./money";

export type ChargeForFiling = {
  id: string;
  cardId: string;
  cardNickname: string;
  cardLast4: string;
  merchant: string;
  postedAt: string;
  amountCents: number;
};

export async function getChargeForFiling(actor: ExpenseViewer, chargeId: string): Promise<ChargeForFiling> {
  const charge = await prisma.cardStatementCharge.findUnique({
    where: { id: chargeId },
    include: {
      card: { select: { id: true, nickname: true, last4: true, ownerId: true, holderIds: true, archivedAt: true } },
      expense: { select: { id: true } },
    },
  });
  if (!charge || !canFileOnCard(actor, charge.card)) throw new ExpenseError("not_found", "That charge wasn't found.");
  const amountCents = parseMoneyToCents(charge.amount.toString()) ?? 0;
  if (charge.expense || amountCents <= 0) throw new ExpenseError("not_found", "That charge doesn't need a receipt.");
  return {
    id: charge.id,
    cardId: charge.cardId,
    cardNickname: charge.card.nickname,
    cardLast4: charge.card.last4,
    merchant: charge.merchant,
    postedAt: charge.postedAt.toISOString().slice(0, 10),
    amountCents,
  };
}
