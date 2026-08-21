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
  // The column this card sits in: UNASSIGNED or a projectId. A member staffed on
  // multiple projects has one card (with a distinct columnKey) per project, so
  // card identity on the board is (userId, columnKey), not userId alone.
  columnKey: string;
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
  // For an assigned column, the highest assignment level (P3 > P2 > P1) among
  // selected domains — drives the default Mentor badge.
  level: Level | null;
  // Domain ids selected for the live staffing assignment on this project.
  // Empty when Unassigned. Clicking a domain chip toggles membership here.
  assignmentDomainIds: string[];
  // Member's top 3 project preferences in rank order. Always shown on the card.
  // Deduped by (projectId, rank): a member can bid the same project at one rank
  // in multiple domains (e.g. Evergreen #1 as both Fullstack and UI/UX), which
  // is one pick as far as the card is concerned — the bid domain isn't the
  // member's role (see matchesDomainFilter) and isn't shown.
  topPreferences: { projectId: string; rank: number }[];
  // Mirrors MemberInput.unresolvedBid — the card renders a badge so the member
  // is visibly distinguished from one who simply hasn't been placed yet.
  unresolvedBid: boolean;
  // Mirrors MemberInput.manuallyAdded — drives the card's remove (×) button.
  manuallyAdded: boolean;
  // Set for synthetic external-mentor cards (see ExternalMentor): a non-roster
  // mentor placed on a project column. Rendered distinctly, not draggable, and
  // removed via its placement id rather than board-member APIs.
  isExternalMentor?: boolean;
  externalMentorId?: string;
};

export const UNASSIGNED = "__unassigned__";

/**
 * A member can hold both a Proposed and a Confirmed StaffingAssignment on the
 * same project in a cycle: dragging after finalize writes a fresh Proposed row
 * without touching the audit-trail Confirmed one. The board (and finalize) treat
 * a member's LIVE assignment(s) on a project as their Proposed rows if any, else
 * Confirmed — so an in-progress re-edit wins over the already-finalized position.
 * Declined rows are audit only and must be filtered out before calling this.
 *
 * A member can be staffed on multiple projects at once (one card per project),
 * so dedup is scoped per (userId, projectId): Proposed wins over Confirmed within
 * a single (user, project), and rows on OTHER projects are never dropped. Within
 * a (user, project), once any Proposed row exists it is the live roster, so
 * leftover Confirmed domains for that project are dropped (re-edit wins).
 */
export function dedupeLiveAssignments<
  T extends { userId: string; projectId: string; status: string; domainId?: string },
>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.userId}|${r.projectId}|${r.domainId ?? ""}`;
    const existing = byKey.get(key);
    if (!existing || (existing.status === "Confirmed" && r.status === "Proposed")) {
      byKey.set(key, r);
    }
  }
  const collapsed = Array.from(byKey.values());
  const proposedByProject = new Set(
    collapsed
      .filter((r) => r.status === "Proposed")
      .map((r) => `${r.userId}|${r.projectId}`),
  );
  return collapsed.filter(
    (r) =>
      r.status === "Proposed" || !proposedByProject.has(`${r.userId}|${r.projectId}`),
  );
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

  const projectSet = new Set(projectIds);
  // userId → (projectId → that project's assignment rows). Rows on a project that
  // isn't a board column (e.g. an archived project a member bid) are ignored here
  // so the card falls back to Unassigned.
  const byUserProject = new Map<string, Map<string, Assignment[]>>();
  for (const a of assignments) {
    if (!projectSet.has(a.projectId)) continue;
    let projects = byUserProject.get(a.userId);
    if (!projects) {
      projects = new Map();
      byUserProject.set(a.userId, projects);
    }
    const list = projects.get(a.projectId) ?? [];
    list.push(a);
    projects.set(a.projectId, list);
  }

  // Initialise columns even when empty so the UI can render placeholders.
  const columns: Record<string, MemberCardModel[]> = { [UNASSIGNED]: [] };
  for (const pid of projectIds) columns[pid] = [];

  for (const m of members) {
    const projects = byUserProject.get(m.userId);
    if (!projects || projects.size === 0) {
      // No live assignment on any board column → sits in the Unassigned pool.
      columns[UNASSIGNED].push(toCard(m, UNASSIGNED, []));
      continue;
    }
    // One card per project the member is staffed on.
    for (const [projectId, rows] of projects) {
      columns[projectId].push(toCard(m, projectId, rows));
    }
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

// Build the card for a member in one column. `columnAssignments` are that
// column's live rows for the member (empty for the Unassigned pool).
function toCard(
  member: MemberInput,
  columnKey: string,
  columnAssignments: Assignment[],
): MemberCardModel {
  const prefsByProject = new Map(member.preferences.map((p) => [p.projectId, p]));
  const rank = { P1: 1, P2: 2, P3: 3 } as const;

  let level: Level | null;
  if (columnKey === UNASSIGNED) {
    level = topPreference(member.preferences)?.level ?? null;
  } else if (columnAssignments.length > 0) {
    level = columnAssignments.reduce<Level>(
      (best, a) => (rank[a.level] > rank[best] ? a.level : best),
      columnAssignments[0].level,
    );
  } else {
    level = prefsByProject.get(columnKey)?.level ?? null;
  }

  return {
    userId: member.userId,
    columnKey,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    photoUrl: member.photoUrl,
    isAdmin: member.isAdmin,
    coreTitles: member.coreTitles,
    domainLevels: member.domainLevels,
    level,
    assignmentDomainIds: columnAssignments.map((a) => a.domainId),
    topPreferences: topPreferences(member.preferences),
    unresolvedBid: member.unresolvedBid ?? false,
    manuallyAdded: member.manuallyAdded ?? false,
  };
}

// Top 3 project picks in rank order, deduped by (projectId, rank) — a member who
// bid the same project at the same rank in several domains picked it once. The
// 3-item cap counts distinct (project, rank) entries, not raw preference rows,
// so the per-domain expansion can't crowd out real picks.
function topPreferences(prefs: Preference[]): { projectId: string; rank: number }[] {
  const byKey = new Map<string, { projectId: string; rank: number }>();
  for (const p of [...prefs].sort((a, b) => a.preferenceRank - b.preferenceRank)) {
    const key = `${p.projectId}::${p.preferenceRank}`;
    if (!byKey.has(key)) {
      byKey.set(key, { projectId: p.projectId, rank: p.preferenceRank });
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
 * Resolve which (domainId, level) rows to record when a member is dragged into
 * a project column. Preference order:
 *   1. All of the member's preferences for that project (multi-domain bids →
 *      multi-domain assignment).
 *   2. The member's top-ranked preference overall (fallback when they didn't
 *      bid on this project but a lead is staffing them anyway).
 *   3. DomainEligibility: every eligibility when they have one or more — with
 *      multiple domains the board seeds the first and the lead clicks chips to
 *      add/remove. (Returning null only when there is nothing to infer.)
 */
export function resolveAssignmentDomains(
  member: MemberInput,
  targetProjectId: string,
): { domainId: string; level: Level }[] | null {
  const matching = member.preferences.filter((p) => p.projectId === targetProjectId);
  if (matching.length > 0) {
    const rank = { P1: 1, P2: 2, P3: 3 } as const;
    const byDomain = new Map<string, Level>();
    for (const p of matching) {
      const prev = byDomain.get(p.domainId);
      if (!prev || rank[p.level] > rank[prev]) byDomain.set(p.domainId, p.level);
    }
    return [...byDomain.entries()].map(([domainId, level]) => ({ domainId, level }));
  }
  const top = topPreference(member.preferences);
  if (top) return [{ domainId: top.domainId, level: top.level }];
  if (member.domainLevels.length === 1) {
    const only = member.domainLevels[0];
    return [{ domainId: only.domainId, level: only.level }];
  }
  if (member.domainLevels.length > 1) {
    // Ambiguous: seed with the first eligibility so the card can land on the
    // column; the lead clicks other domain chips to add (or deselect).
    const first = member.domainLevels[0];
    return [{ domainId: first.domainId, level: first.level }];
  }
  return null;
}

/**
 * Does this member belong on the board while it's filtered to one domain?
 *
 * The question the filter answers is "who works in this domain", so the answer
 * comes from DomainEligibility (the member's hired role) — NOT from their bids.
 * A bid's domainId is not a claim about the bidder: bid-validation assigns one
 * per ranked project purely to satisfy the row's unique key, falling back to the
 * project's first declared domain when the member is eligible in none of them.
 * Matching on it meant ranking a project was enough to appear under that
 * project's domain, which with a handful of bids each let nearly everyone
 * through every filter.
 *
 * A live assignment still counts. That one IS a domain decision — a lead put
 * them there — and dropping it would make a real placement vanish from the
 * column it's sitting in.
 */
export function matchesDomainFilter(
  member: MemberInput,
  domainId: string,
  assignedUserIds: ReadonlySet<string>,
): boolean {
  return (
    member.domainLevels.some((d) => d.domainId === domainId) ||
    assignedUserIds.has(member.userId)
  );
}

/** @deprecated Prefer resolveAssignmentDomains — kept for callers that want one. */
export function resolveAssignmentInputs(
  member: MemberInput,
  targetProjectId: string,
): { domainId: string; level: Level } | null {
  const domains = resolveAssignmentDomains(member, targetProjectId);
  return domains?.[0] ?? null;
}
