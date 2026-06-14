// Pure helpers for the staffing board. Keeping these in lib/ + unit-tested
// means the route loader/action stay thin and we can iterate on board shape
// without dragging Prisma + React in.

import type { Level } from "~/lib/level";
export type { Level };

export type Preference = {
  projectId: string;
  domainId: string;
  level: Level;
  preferenceRank: number;
  notes: string | null;
};

// A domain the member is eligible in, with their level there. Sourced from
// DomainEligibility (one row per user+domain). Shown on every card; domainId
// also lets the board infer a non-bidding member's assignment domain.
export type DomainLevel = {
  domainId: string;
  domainName: string;
  level: Level;
};

// One labeled answer from the member's Project Bids form submission — the full
// bid content shown in the BidModal (question label + resolved string value).
export type BidField = {
  label: string;
  value: string;
};

export type MemberInput = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  photoUrl: string | null;
  isAdmin: boolean;
  coreTitles: string[];
  preferences: Preference[];
  // The member's full Project Bids form answers (label/value), shown in the
  // BidModal alongside the resolved rankings. Empty when there's no submission.
  bidFields: BidField[];
  domainLevels: DomainLevel[];
  // True when the member submitted a project-bids form for this cycle but it
  // produced no usable preference (e.g. the bid projects have no open role in
  // an eligibility domain). They still belong on the board — flagged — so a
  // staffing lead notices, rather than vanishing. Derived in the loader; never
  // set for members whose preferences resolved normally.
  unresolvedBid?: boolean;
  // True when a staffing lead manually placed this member on the board (no bid)
  // via StaffingBoardMember. Drives the card's remove (×) affordance. A member
  // who also bid is sourced from their preferences instead, so this stays false.
  manuallyAdded?: boolean;
};

export type Assignment = {
  userId: string;
  projectId: string;
  domainId: string;
  level: Level;
};

export type MemberCardModel = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  photoUrl: string | null;
  isAdmin: boolean;
  coreTitles: string[];
  // Every domain the member is eligible in + their level there. Shown as
  // chips on the card regardless of column.
  domainLevels: DomainLevel[];
  // Level to display on the card. For Unassigned, the top-preference level.
  // For an assigned column, the level recorded on the assignment row.
  level: Level | null;
  // Member's top 3 project preferences in rank order. Always shown on the card.
  // Deduped by (projectId, rank): a member can bid the same project at one rank
  // in multiple domains (e.g. Evergreen #1 as both Fullstack and UI/UX) — those
  // collapse to one entry whose `domainIds` lists each bid domain, so the card
  // shows the project once with its domains rather than repeating the line.
  topPreferences: { projectId: string; rank: number; domainIds: string[] }[];
  // Mirrors MemberInput.unresolvedBid — the card renders a badge so the member
  // is visibly distinguished from one who simply hasn't been placed yet.
  unresolvedBid: boolean;
  // Mirrors MemberInput.manuallyAdded — drives the card's remove (×) button.
  manuallyAdded: boolean;
};

export const UNASSIGNED = "__unassigned__";

/**
 * A member can hold both a Proposed and a Confirmed StaffingAssignment in the
 * same cycle: dragging after finalize writes a fresh Proposed row without
 * touching the audit-trail Confirmed one. The board (and finalize) treat a
 * member's LIVE assignment as their Proposed row if present, else Confirmed —
 * so an in-progress re-edit wins over the already-finalized position. Declined
 * rows are audit only and must be filtered out before calling this.
 *
 * Returns one row per userId. Input order is otherwise preserved.
 */
export function dedupeLiveAssignments<T extends { userId: string; status: string }>(
  rows: T[],
): T[] {
  const byUser = new Map<string, T>();
  for (const r of rows) {
    const existing = byUser.get(r.userId);
    if (!existing || (existing.status === "Confirmed" && r.status === "Proposed")) {
      byUser.set(r.userId, r);
    }
  }
  return Array.from(byUser.values());
}

/**
 * Build the board's column→cards index from raw data. The output is stable
 * across re-renders: members sort by lastName, firstName; columns are not
 * pre-keyed here (the renderer iterates `projectIds` in display order and
 * looks up each).
 */
export function buildBoard(args: {
  projectIds: string[];
  members: MemberInput[];
  assignments: Assignment[];
  // Manual card-order rows. A row applies only when its columnKey matches the
  // card's resolved column, so a stale order from before a move is ignored.
  // Cards with an applicable row sort first (ascending sortKey); the rest fall
  // back to last-name.
  cardOrder?: { userId: string; columnKey: string; sortKey: number }[];
}): Record<string, MemberCardModel[]> {
  const { projectIds, members, assignments, cardOrder = [] } = args;

  // (columnKey → (userId → sortKey)) for column-scoped lookup.
  const orderByColumn = new Map<string, Map<string, number>>();
  for (const o of cardOrder) {
    let m = orderByColumn.get(o.columnKey);
    if (!m) {
      m = new Map();
      orderByColumn.set(o.columnKey, m);
    }
    m.set(o.userId, o.sortKey);
  }

  const byUser = new Map<string, Assignment>();
  for (const a of assignments) {
    // If multiple proposals exist for the same user (shouldn't, but be
    // defensive), the latest write wins. Loader sorts to make this stable.
    byUser.set(a.userId, a);
  }

  // Initialise columns even when empty so the UI can render placeholders.
  const columns: Record<string, MemberCardModel[]> = { [UNASSIGNED]: [] };
  for (const pid of projectIds) columns[pid] = [];

  for (const m of members) {
    const assignment = byUser.get(m.userId) ?? null;
    const columnKey = assignment?.projectId && columns[assignment.projectId]
      ? assignment.projectId
      : UNASSIGNED;

    const card = toCard(m, columnKey, assignment);
    columns[columnKey].push(card);
  }

  // Order within each column: cards with a manual sortKey lead (ascending),
  // then the rest alphabetically by last, first name. A card whose order was
  // saved in a different column has no entry here (the loader keys order by
  // user, not column), so it just falls into the alphabetical tail — correct,
  // since its old position no longer applies.
  const byName = (a: MemberCardModel, b: MemberCardModel) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  for (const key of Object.keys(columns)) {
    const order = orderByColumn.get(key);
    columns[key].sort((a, b) => {
      const oa = order?.get(a.userId);
      const ob = order?.get(b.userId);
      if (oa != null && ob != null) return oa - ob;
      if (oa != null) return -1;
      if (ob != null) return 1;
      return byName(a, b);
    });
  }

  return columns;
}

function toCard(
  member: MemberInput,
  columnKey: string,
  assignment: Assignment | null,
): MemberCardModel {
  const prefsByProject = new Map(member.preferences.map((p) => [p.projectId, p]));

  let level: Level | null;
  if (columnKey === UNASSIGNED) {
    level = topPreference(member.preferences)?.level ?? null;
  } else {
    level = assignment?.level ?? prefsByProject.get(columnKey)?.level ?? null;
  }

  return {
    userId: member.userId,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    photoUrl: member.photoUrl,
    isAdmin: member.isAdmin,
    coreTitles: member.coreTitles,
    domainLevels: member.domainLevels,
    level,
    topPreferences: topPreferences(member.preferences),
    unresolvedBid: member.unresolvedBid ?? false,
    manuallyAdded: member.manuallyAdded ?? false,
  };
}

// Top 3 project picks in rank order, deduped by (projectId, rank). When a member
// bids the same project at the same rank in several domains, the entry's
// `domainIds` lists each (in first-seen order). The 3-item cap counts distinct
// (project, rank) entries, not raw preference rows.
function topPreferences(
  prefs: Preference[],
): { projectId: string; rank: number; domainIds: string[] }[] {
  const byKey = new Map<string, { projectId: string; rank: number; domainIds: string[] }>();
  for (const p of [...prefs].sort((a, b) => a.preferenceRank - b.preferenceRank)) {
    const key = `${p.projectId}::${p.preferenceRank}`;
    const entry = byKey.get(key);
    if (entry) {
      if (!entry.domainIds.includes(p.domainId)) entry.domainIds.push(p.domainId);
    } else {
      byKey.set(key, {
        projectId: p.projectId,
        rank: p.preferenceRank,
        domainIds: [p.domainId],
      });
    }
  }
  return Array.from(byKey.values()).slice(0, 3);
}

function topPreference(prefs: Preference[]): Preference | null {
  if (prefs.length === 0) return null;
  return prefs.reduce((best, cur) =>
    cur.preferenceRank < best.preferenceRank ? cur : best,
  );
}

/**
 * Resolve which (domainId, level) to record on a new StaffingAssignment when
 * a member is dragged into a project column. Preference order:
 *   1. The member's existing preference for that project (the bid).
 *   2. The member's top-ranked preference overall (fallback when they didn't
 *      bid on this project but a lead is staffing them anyway).
 *   3. The member's DomainEligibility when they have exactly one — lets a lead
 *      place a manually-added, non-bidding member (their eligibility is the
 *      only domain+level they could be staffed at).
 *   4. null → caller must reject (no bid and no single eligibility to infer
 *      from; a member eligible in multiple domains is ambiguous here).
 */
export function resolveAssignmentInputs(
  member: MemberInput,
  targetProjectId: string,
): { domainId: string; level: Level } | null {
  const matching = member.preferences.find((p) => p.projectId === targetProjectId);
  if (matching) return { domainId: matching.domainId, level: matching.level };
  const top = topPreference(member.preferences);
  if (top) return { domainId: top.domainId, level: top.level };
  if (member.domainLevels.length === 1) {
    const only = member.domainLevels[0];
    return { domainId: only.domainId, level: only.level };
  }
  return null;
}
