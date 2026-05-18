// Pure helpers for the staffing board. Keeping these in lib/ + unit-tested
// means the route loader/action stay thin and we can iterate on board shape
// without dragging Prisma + React in.

export type Level = "P1" | "P2" | "P3";

export type Preference = {
  projectId: string;
  domainId: string;
  level: Level;
  preferenceRank: number;
  notes: string | null;
};

// A domain the member is eligible in, with their level there. Sourced from
// DomainEligibility (one row per user+domain). Shown on every card.
export type DomainLevel = {
  domainName: string;
  level: Level;
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
  domainLevels: DomainLevel[];
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
  topPreferences: { projectId: string; rank: number }[];
};

export const UNASSIGNED = "__unassigned__";

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
}): Record<string, MemberCardModel[]> {
  const { projectIds, members, assignments } = args;

  const byUser = new Map<string, Assignment>();
  for (const a of assignments) {
    // If multiple proposals exist for the same user (shouldn't, but be
    // defensive), the latest write wins. Loader sorts to make this stable.
    byUser.set(a.userId, a);
  }

  // Initialise columns even when empty so the UI can render placeholders.
  const columns: Record<string, MemberCardModel[]> = { [UNASSIGNED]: [] };
  for (const pid of projectIds) columns[pid] = [];

  const sortedMembers = [...members].sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName);
    if (ln !== 0) return ln;
    return a.firstName.localeCompare(b.firstName);
  });

  for (const m of sortedMembers) {
    const assignment = byUser.get(m.userId) ?? null;
    const columnKey = assignment?.projectId && columns[assignment.projectId]
      ? assignment.projectId
      : UNASSIGNED;

    const card = toCard(m, columnKey, assignment);
    columns[columnKey].push(card);
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
    topPreferences: [...member.preferences]
      .sort((a, b) => a.preferenceRank - b.preferenceRank)
      .slice(0, 3)
      .map((p) => ({ projectId: p.projectId, rank: p.preferenceRank })),
  };
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
 *   3. null → caller must reject (no preferences at all).
 */
export function resolveAssignmentInputs(
  member: MemberInput,
  targetProjectId: string,
): { domainId: string; level: Level } | null {
  const matching = member.preferences.find((p) => p.projectId === targetProjectId);
  if (matching) return { domainId: matching.domainId, level: matching.level };
  const top = topPreference(member.preferences);
  if (top) return { domainId: top.domainId, level: top.level };
  return null;
}
