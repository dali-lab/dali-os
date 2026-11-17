export type ExpenseViewer = {
  userId: string;
  isCore: boolean;
  isStaff: boolean;
  ownedCardIds: readonly string[];
};

export type ExpenseRef = {
  submitterId: string;
  paidWith: "STAFF_CARD" | "OWN_CARD" | null;
  cardId: string | null;
  cardArchived?: boolean;
};

export type CardRef = {
  id: string;
  ownerId: string;
  holderIds: readonly string[];
  archivedAt: Date | string | null;
};

export type ExpenseTabs = {
  yours: boolean;
  approvals: boolean;
  all: boolean;
  cards: boolean;
};

function ownsCard(viewer: ExpenseViewer, cardId: string | null): boolean {
  return cardId !== null && viewer.ownedCardIds.includes(cardId);
}

export function canViewExpense(viewer: ExpenseViewer, expense: ExpenseRef): boolean {
  if (viewer.userId === expense.submitterId) return true;
  if (viewer.isStaff || viewer.isCore) return true;
  return ownsCard(viewer, expense.cardId);
}

export function canApproveExpense(viewer: ExpenseViewer, expense: ExpenseRef): boolean {
  if (viewer.userId === expense.submitterId) return false;
  if (viewer.isStaff) return true;
  if (expense.paidWith !== "STAFF_CARD" || expense.cardArchived) return false;
  return ownsCard(viewer, expense.cardId);
}

export function canMatchCharge(viewer: ExpenseViewer, expense: ExpenseRef): boolean {
  if (expense.paidWith !== "STAFF_CARD") return false;
  return viewer.isCore || ownsCard(viewer, expense.cardId);
}

export function canMarkPaid(viewer: ExpenseViewer, expense: ExpenseRef): boolean {
  return viewer.isStaff || viewer.userId === expense.submitterId;
}

export function canViewCard(viewer: ExpenseViewer, cardId: string): boolean {
  return viewer.isCore || ownsCard(viewer, cardId);
}

export function canManageCards(viewer: ExpenseViewer): boolean {
  return viewer.isCore;
}

export function canManageCategories(viewer: ExpenseViewer): boolean {
  return viewer.isCore;
}

export function canImportStatement(viewer: ExpenseViewer, cardId: string): boolean {
  return canViewCard(viewer, cardId);
}

export function canFileOnCard(viewer: ExpenseViewer, card: CardRef): boolean {
  if (card.archivedAt) return false;
  return card.ownerId === viewer.userId || card.holderIds.includes(viewer.userId);
}

export function expenseTabs(viewer: ExpenseViewer): ExpenseTabs {
  return {
    yours: true,
    approvals: viewer.isStaff || viewer.ownedCardIds.length > 0,
    all: viewer.isCore || viewer.isStaff,
    cards: viewer.isCore || viewer.ownedCardIds.length > 0,
  };
}
