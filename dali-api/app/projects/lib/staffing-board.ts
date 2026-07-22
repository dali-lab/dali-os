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
  // For an assigned column, the highest assignment level (P3 > P2 > P1) among
  // selected domains — drives the default Mentor badge.
  level: Level | null;
  // Domain ids selected for the live staffing assignment on this project.
  // Empty when Unassigned. Clicking a domain chip toggles membership here.
  assignmentDomainIds: string[];
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
  // Set for synthetic external-mentor cards (see ExternalMentor): a non-roster
  // mentor placed on a project column. Rendered distinctly, not draggable, and
  // removed via its placement id rather than board-member APIs.
  isExternalMentor?: boolean;
  externalMentorId?: string;
};

export const UNASSIGNED = "__unassigned__";

/**
 * A member can hold both a Proposed and a Confirmed StaffingAssignment in the
 * same cycle: dragging after finalize writes a fresh Proposed row without
 * touching the audit-trail Confirmed one. The board (and finalize) treat a
 * member's LIVE assignment(s) as their Proposed rows if any, else Confirmed —
 * so an in-progress re-edit wins over the already-finalized position. Declined
 * rows are audit only and must be filtered out before calling this.
 *
 * Multiple domains per user on one project are allowed (one row per
 * userId+domainId). When the user has any Proposed row, Confirmed rows for
 * other domains/projects are dropped so a drag-away doesn't leave them on
 * two projects at once.
 */
export function dedupeLiveAssignments<
  T extends { userId: string; status: string; domainId?: string },
>(rows: T[]): T[] {
  const byDomain = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.userId}|${r.domainId ?? ""}`;
    const existing = byDomain.get(key);
    if (!existing || (existing.status === "Confirmed" && r.status === "Proposed")) {
      byDomain.set(key, r);
    }
  }
  const collapsed = Array.from(byDomain.values());
  const usersWithProposed = new Set(
    collapsed.filter((r) => r.status === "Proposed").map((r) => r.userId),
  );
  return collapsed.filter(
    (r) => r.status === "Proposed" || !usersWithProposed.has(r.userId),
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

  const byUser = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  // Initialise columns even when empty so the UI can render placeholders.
  const columns: Record<string, MemberCardModel[]> = { [UNASSIGNED]: [] };
  for (const pid of projectIds) columns[pid] = [];

  for (const m of members) {
    const userAssignments = byUser.get(m.userId) ?? [];
    // All live domains for a user share one project (assign API enforces that).
    const primary = userAssignments[0] ?? null;
    const columnKey =
      primary?.projectId && columns[primary.projectId]
        ? primary.projectId
        : UNASSIGNED;

    const card = toCard(m, columnKey, primary, userAssignments);
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
  primary: Assignment | null,
  userAssignments: Assignment[],
): MemberCardModel {
  const prefsByProject = new Map(member.preferences.map((p) => [p.projectId, p]));
  const rank = { P1: 1, P2: 2, P3: 3 } as const;

  let level: Level | null;
  if (columnKey === UNASSIGNED) {
    level = topPreference(member.preferences)?.level ?? null;
  } else if (userAssignments.length > 0) {
    level = userAssignments.reduce<Level>(
      (best, a) => (rank[a.level] > rank[best] ? a.level : best),
      userAssignments[0].level,
    );
  } else {
    level = primary?.level ?? prefsByProject.get(columnKey)?.level ?? null;
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
    assignmentDomainIds: userAssignments.map((a) => a.domainId),
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

/** @deprecated Prefer resolveAssignmentDomains — kept for callers that want one. */
export function resolveAssignmentInputs(
  member: MemberInput,
  targetProjectId: string,
): { domainId: string; level: Level } | null {
  const domains = resolveAssignmentDomains(member, targetProjectId);
  return domains?.[0] ?? null;
}
