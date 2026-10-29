export const RENEWAL_COLUMNS = ["undecided", "continuing", "not_continuing"] as const;
export type RenewalColumn = (typeof RENEWAL_COLUMNS)[number];

export const RENEWAL_COLUMN_LABELS: Record<RenewalColumn, string> = {
  undecided: "Undecided",
  continuing: "Continuing",
  not_continuing: "Not continuing",
};

export type RenewalRole = { domainId: string; name: string; slots: number };

export type RenewalCardModel = {
  projectId: string;
  name: string;
  iconEmoji: string | null;
  orgName: string | null;
  termCount: number;
  column: RenewalColumn;
  fromTermCode: string | null;
  nextStep: string | null;
  nextStepDueAt: string | null;
  lastContactAt: string | null;
  reason: string | null;
  feeCents: number | null;
  lastRoles: RenewalRole[];
  decidedRoles: RenewalRole[];
};

export type StatusRow = { sortKey: number; code: string; isContinuing: boolean | null };

export function classifyDecision(
  rows: StatusRow[],
  decisionSortKey: number,
): { column: RenewalColumn; fromTermCode: string | null; effectiveCode: string | null } {
  const atDecision = rows.find((r) => r.sortKey === decisionSortKey);
  if (!atDecision) return { column: "undecided", fromTermCode: null, effectiveCode: null };
  if (atDecision.isContinuing == null) {
    return { column: "undecided", fromTermCode: null, effectiveCode: null };
  }
  if (atDecision.isContinuing) {
    return { column: "continuing", fromTermCode: null, effectiveCode: atDecision.code };
  }
  const later = rows
    .filter((r) => r.sortKey > decisionSortKey && r.isContinuing)
    .sort((a, b) => a.sortKey - b.sortKey)[0];
  if (later) return { column: "continuing", fromTermCode: later.code, effectiveCode: later.code };
  return { column: "not_continuing", fromTermCode: null, effectiveCode: null };
}

export type NextStepFields = { nextStep: string | null; nextStepDueAt: Date | null };

export function normalizeNextStep(step: string, dueIso: string): NextStepFields {
  const nextStep = step.trim();
  if (!nextStep) return { nextStep: null, nextStepDueAt: null };
  const due = /^\d{4}-\d{2}-\d{2}$/.test(dueIso) ? new Date(`${dueIso}T00:00:00.000Z`) : null;
  return { nextStep, nextStepDueAt: due && !Number.isNaN(due.getTime()) ? due : null };
}

export function dueToInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function totalSlots(roles: RenewalRole[]): number {
  return roles.reduce((sum, r) => sum + r.slots, 0);
}

export function rolesLabel(code: string, roles: RenewalRole[]): string {
  const parts = roles.filter((r) => r.slots > 0).map((r) => `${r.name} ${r.slots}`);
  return parts.length ? `${code}: ${parts.join(", ")}` : `${code}: none requested`;
}

export function spotsHeader(total: number, code: string): string {
  return `${total} ${total === 1 ? "spot" : "spots"} in ${code}`;
}

export function isNextStepOverdue(dueIso: string | null, now: Date): boolean {
  if (!dueIso) return false;
  const due = new Date(dueIso);
  return (
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) >
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  );
}

export function isContactStale(lastIso: string | null, staleDays: number, now: Date): boolean {
  if (!lastIso) return false;
  return now.getTime() - new Date(lastIso).getTime() > staleDays * 86_400_000;
}

export function matchesRenewalQuery(card: RenewalCardModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return card.name.toLowerCase().includes(q) || (card.orgName ?? "").toLowerCase().includes(q);
}

export function groupRenewals(cards: RenewalCardModel[]): Record<RenewalColumn, RenewalCardModel[]> {
  const out: Record<RenewalColumn, RenewalCardModel[]> = {
    undecided: [],
    continuing: [],
    not_continuing: [],
  };
  for (const c of cards) out[c.column].push(c);
  for (const col of RENEWAL_COLUMNS) out[col].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function nextTerm<T extends { sortKey: number }>(terms: T[], pickedSortKey: number): T | null {
  return (
    terms.filter((t) => t.sortKey > pickedSortKey).sort((a, b) => a.sortKey - b.sortKey)[0] ?? null
  );
}

export type StatusWrite = { termId: string; isContinuing: boolean };

export function continueStatusWrites(decisionTermId: string, chosenTermId: string): StatusWrite[] {
  return chosenTermId === decisionTermId
    ? [{ termId: chosenTermId, isContinuing: true }]
    : [
        { termId: decisionTermId, isContinuing: false },
        { termId: chosenTermId, isContinuing: true },
      ];
}

export function normalizeRoles(
  roles: { domainId: string; slots: number }[],
): { domainId: string; slots: number }[] {
  const merged = new Map<string, number>();
  for (const r of roles) {
    const slots = Math.floor(r.slots);
    if (!r.domainId || !Number.isFinite(slots) || slots <= 0) continue;
    merged.set(r.domainId, (merged.get(r.domainId) ?? 0) + slots);
  }
  return [...merged].map(([domainId, slots]) => ({ domainId, slots }));
}

export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number | null): string {
  return cents == null ? "" : String(cents / 100);
}

export function stepSlots(roles: RenewalRole[], domainId: string, delta: number): RenewalRole[] {
  return roles
    .map((r) => (r.domainId === domainId ? { ...r, slots: Math.max(0, r.slots + delta) } : r))
    .filter((r) => r.slots > 0 || r.domainId !== domainId);
}

export function addDomainRole(roles: RenewalRole[], domainId: string, name: string): RenewalRole[] {
  return roles.some((r) => r.domainId === domainId) ? roles : [...roles, { domainId, name, slots: 1 }];
}

const INTENT_COLUMN: Record<string, RenewalColumn> = {
  continue: "continuing",
  "not-continuing": "not_continuing",
  undecided: "undecided",
};

/** Moves the card a decision is being saved for into its target column, so the
 *  board doesn't wait for the reload to show the move. */
export function withPendingDecision(
  cards: RenewalCardModel[],
  pending: { intent: string; projectId: string } | null,
): RenewalCardModel[] {
  const column = pending ? INTENT_COLUMN[pending.intent] : undefined;
  if (!pending || !column) return cards;
  return cards.map((c) => (c.projectId === pending.projectId ? { ...c, column } : c));
}
