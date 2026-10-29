import type { ColumnMapping } from "~/projects/lib/slot-roles";

export type PlanningSource = "renewing" | "new";

export type PlanningState =
  | "Continuing"
  | "Undecided"
  | "Accepted"
  | "New"
  | "Interview"
  | "Deciding";

export type PlanningItem = {
  key: string;
  kind: "project" | "application";
  refId: string;
  name: string;
  iconEmoji?: string | null;
  source: PlanningSource;
  state: PlanningState;
  spotsByDomain: Record<string, number>;
};

export type PlanningDomain = { id: string; name: string };

export type ReturningPerson = { userId: string; domainIds: string[] };

export type PlanningBreakdownRow = PlanningItem & {
  count: number;
  counted: boolean;
};

export type PlanningDomainRow = {
  domainId: string;
  name: string;
  renewing: number;
  fresh: number;
  spots: number;
  intent: number;
  gap: number;
  items: PlanningBreakdownRow[];
};

export type PlanningGapModel = {
  rows: PlanningDomainRow[];
  empty: PlanningDomainRow[];
  totals: {
    renewing: number;
    fresh: number;
    spots: number;
    intent: number;
    shortfall: number;
    noDomain: number;
  };
};

const POTENTIAL_STATES: ReadonlySet<PlanningState> = new Set(["Undecided", "New", "Interview", "Deciding"]);

export function isPotentialState(state: PlanningState): boolean {
  return POTENTIAL_STATES.has(state);
}

export function planningStateLabel(item: Pick<PlanningItem, "source" | "state">): string {
  return `${item.source === "renewing" ? "Renewal" : "New"} · ${item.state}`;
}

export type GapPill = { tone: "bad" | "idle" | "ok"; label: string };

export function gapPill(gap: number): GapPill {
  if (gap > 0) return { tone: "bad", label: `${gap} short` };
  if (gap < 0) return { tone: "ok", label: `${-gap} extra` };
  return { tone: "idle", label: "Even" };
}

export function buildPlanningGap(input: {
  domains: PlanningDomain[];
  items: PlanningItem[];
  returning: ReturningPerson[];
  includePotential: boolean;
}): PlanningGapModel {
  const { domains, items, returning, includePotential } = input;

  const peopleByDomain = new Map<string, Set<string>>();
  const withDomain = new Set<string>();
  const everyone = new Set<string>();
  for (const person of returning) {
    everyone.add(person.userId);
    for (const domainId of person.domainIds) {
      withDomain.add(person.userId);
      const set = peopleByDomain.get(domainId) ?? new Set<string>();
      set.add(person.userId);
      peopleByDomain.set(domainId, set);
    }
  }

  const all: PlanningDomainRow[] = domains.map((domain) => {
    const breakdown: PlanningBreakdownRow[] = items
      .filter((item) => (item.spotsByDomain[domain.id] ?? 0) > 0)
      .map((item) => ({
        ...item,
        count: item.spotsByDomain[domain.id],
        counted: includePotential || !isPotentialState(item.state),
      }))
      .sort(
        (a, b) =>
          Number(a.source === "new") - Number(b.source === "new") ||
          Number(!a.counted) - Number(!b.counted) ||
          a.name.localeCompare(b.name),
      );
    const renewing = sumCounted(breakdown, "renewing");
    const fresh = sumCounted(breakdown, "new");
    const spots = renewing + fresh;
    const intent = peopleByDomain.get(domain.id)?.size ?? 0;
    return {
      domainId: domain.id,
      name: domain.name,
      renewing,
      fresh,
      spots,
      intent,
      gap: spots - intent,
      items: breakdown,
    };
  });

  const rows = all
    .filter((r) => r.spots > 0 || r.intent > 0 || r.items.length > 0)
    .sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name));
  const empty = all
    .filter((r) => r.spots === 0 && r.intent === 0 && r.items.length === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const renewing = rows.reduce((n, r) => n + r.renewing, 0);
  const fresh = rows.reduce((n, r) => n + r.fresh, 0);
  return {
    rows,
    empty,
    totals: {
      renewing,
      fresh,
      spots: renewing + fresh,
      intent: withDomain.size,
      shortfall: rows.reduce((n, r) => n + Math.max(r.gap, 0), 0),
      noDomain: everyone.size - withDomain.size,
    },
  };
}

function sumCounted(rows: PlanningBreakdownRow[], source: PlanningSource): number {
  return rows.reduce((n, r) => (r.counted && r.source === source ? n + r.count : n), 0);
}

export type ProjectPlanningInput = {
  id: string;
  name: string;
  iconEmoji?: string | null;
  termSortKey: number;
  earliestSortKey: number | null;
  inPreviousTerm: boolean;
  decision: boolean | null;
  thisTermSpots: Record<string, number>;
  previousTermSpots: Record<string, number>;
};

export function projectToPlanningItem(p: ProjectPlanningInput): PlanningItem | null {
  if (p.earliestSortKey === null || p.earliestSortKey > p.termSortKey) return null;
  const base = { key: `project:${p.id}`, kind: "project" as const, refId: p.id, name: p.name, iconEmoji: p.iconEmoji ?? null };
  const has = (s: Record<string, number>) => Object.values(s).some((n) => n > 0);

  if (p.earliestSortKey === p.termSortKey) {
    return has(p.thisTermSpots)
      ? { ...base, source: "new", state: "Accepted", spotsByDomain: p.thisTermSpots }
      : null;
  }
  if (p.decision === false) return null;
  if (p.decision === true) {
    return has(p.thisTermSpots)
      ? { ...base, source: "renewing", state: "Continuing", spotsByDomain: p.thisTermSpots }
      : null;
  }
  if (has(p.thisTermSpots)) return { ...base, source: "renewing", state: "Undecided", spotsByDomain: p.thisTermSpots };
  return p.inPreviousTerm && has(p.previousTermSpots)
    ? { ...base, source: "renewing", state: "Undecided", spotsByDomain: p.previousTermSpots }
    : null;
}

export type IntentSetup =
  | { kind: "ready" }
  | { kind: "no-form" }
  | { kind: "unmapped"; submissions: number }
  | { kind: "no-statuses"; submissions: number }
  | { kind: "no-responses" };

// The planning term's own staffing cycle collects its intent, so a status
// column with no term set means this term.
export function intentSetupState(input: {
  bound: boolean;
  mapping: ColumnMapping | null;
  submissions: number;
  replied: number;
}): IntentSetup {
  if (input.replied > 0) return { kind: "ready" };
  if (!input.bound) return { kind: "no-form" };
  const mapped = input.mapping?.entries.some((e) => e.role === "intent-status") ?? false;
  if (!mapped) return { kind: "unmapped", submissions: input.submissions };
  if (input.submissions > 0) return { kind: "no-statuses", submissions: input.submissions };
  return { kind: "no-responses" };
}
