import { describe, it, expect } from "vitest";
import {
  buildPlanningGap,
  gapPill,
  isPotentialState,
  planningStateLabel,
  type PlanningItem,
} from "../planning-gap";

const domains = [
  { id: "eng", name: "Engineering" },
  { id: "des", name: "Design" },
  { id: "pm", name: "Product" },
];

function item(over: Partial<PlanningItem> & Pick<PlanningItem, "key" | "state" | "source">): PlanningItem {
  return {
    kind: over.source === "new" && over.state !== "Accepted" ? "application" : "project",
    refId: over.key,
    name: over.key,
    spotsByDomain: { eng: 2 },
    ...over,
  };
}

describe("isPotentialState", () => {
  it("treats only decided states as firm", () => {
    expect(["Continuing", "Accepted"].map((s) => isPotentialState(s as never))).toEqual([false, false]);
    expect(["Undecided", "New", "Interview", "Deciding", "Backlog"].every((s) => isPotentialState(s as never))).toBe(true);
  });
});

describe("planningStateLabel", () => {
  it("joins source and state", () => {
    expect(planningStateLabel({ source: "renewing", state: "Undecided" })).toBe("Renewal · Undecided");
    expect(planningStateLabel({ source: "new", state: "Interview" })).toBe("New · Interview");
  });
});

describe("gapPill", () => {
  it("maps the gap to a tone and label", () => {
    expect(gapPill(3)).toEqual({ tone: "bad", label: "3 short" });
    expect(gapPill(0)).toEqual({ tone: "idle", label: "Even" });
    expect(gapPill(-2)).toEqual({ tone: "ok", label: "2 extra" });
  });
});

describe("buildPlanningGap", () => {
  const items = [
    item({ key: "cont", source: "renewing", state: "Continuing", spotsByDomain: { eng: 3, des: 1 } }),
    item({ key: "undec", source: "renewing", state: "Undecided", spotsByDomain: { eng: 2 } }),
    item({ key: "acc", source: "new", state: "Accepted", spotsByDomain: { eng: 4 } }),
    item({ key: "intv", source: "new", state: "Interview", spotsByDomain: { des: 5 } }),
  ];
  const returning = [
    { userId: "a", domainIds: ["eng", "des"] },
    { userId: "b", domainIds: ["eng"] },
    { userId: "c", domainIds: [] },
  ];

  it("counts only firm rows when potential is off, and keeps the rest listed uncounted", () => {
    const m = buildPlanningGap({ domains, items, returning, includePotential: false });
    const eng = m.rows.find((r) => r.domainId === "eng")!;
    const des = m.rows.find((r) => r.domainId === "des")!;
    expect([eng.renewing, eng.fresh, eng.spots]).toEqual([3, 4, 7]);
    expect(eng.items.map((i) => [i.key, i.counted])).toEqual([
      ["cont", true],
      ["undec", false],
      ["acc", true],
    ]);
    expect(des.spots).toBe(1);
    expect(des.items.find((i) => i.key === "intv")?.counted).toBe(false);
  });

  it("counts potential rows when the toggle is on", () => {
    const m = buildPlanningGap({ domains, items, returning, includePotential: true });
    const eng = m.rows.find((r) => r.domainId === "eng")!;
    const des = m.rows.find((r) => r.domainId === "des")!;
    expect([eng.renewing, eng.fresh]).toEqual([5, 4]);
    expect([des.renewing, des.fresh]).toEqual([1, 5]);
  });

  it("counts supply as distinct returning users and sorts the worst gap first", () => {
    const m = buildPlanningGap({ domains, items, returning, includePotential: true });
    expect(m.rows.map((r) => [r.domainId, r.intent, r.gap])).toEqual([
      ["eng", 2, 7],
      ["des", 1, 5],
    ]);
    expect(m.totals.intent).toBe(2);
    expect(m.totals.noDomain).toBe(1);
  });

  it("sums shortfalls only, so an extra in one domain does not offset another", () => {
    const m = buildPlanningGap({
      domains,
      items: [item({ key: "x", source: "renewing", state: "Continuing", spotsByDomain: { eng: 3 } })],
      returning: [
        { userId: "a", domainIds: ["des"] },
        { userId: "b", domainIds: ["des"] },
      ],
      includePotential: false,
    });
    expect(m.rows.map((r) => r.gap)).toEqual([3, -2]);
    expect(m.totals.shortfall).toBe(3);
    expect(m.totals.spots).toBe(3);
    expect(m.totals.intent).toBe(2);
  });

  it("counts a person eligible in two domains once in the total", () => {
    const m = buildPlanningGap({
      domains,
      items: [],
      returning: [{ userId: "a", domainIds: ["eng", "des"] }],
      includePotential: false,
    });
    expect(m.totals.intent).toBe(1);
    expect(m.rows.map((r) => r.intent)).toEqual([1, 1]);
  });

  it("moves domains with nothing into the empty group", () => {
    const m = buildPlanningGap({ domains, items, returning, includePotential: false });
    expect(m.empty.map((r) => r.domainId)).toEqual(["pm"]);
  });

  it("keeps a domain whose only rows are uncounted in the main table", () => {
    const m = buildPlanningGap({
      domains,
      items: [item({ key: "u", source: "renewing", state: "Undecided", spotsByDomain: { pm: 2 } })],
      returning: [],
      includePotential: false,
    });
    expect(m.rows.map((r) => r.domainId)).toEqual(["pm"]);
    expect(m.rows[0].spots).toBe(0);
  });

  it("lists renewals before new rows in the breakdown", () => {
    const m = buildPlanningGap({ domains, items, returning, includePotential: true });
    const eng = m.rows.find((r) => r.domainId === "eng")!;
    expect(eng.items.map((i) => i.source)).toEqual(["renewing", "renewing", "new"]);
  });
});

import {
  buildPlanningProjects,
  hasSpots,
  intentSetupState,
  projectToPlanningItem,
  type ProjectPlanningInput,
} from "../planning-gap";

describe("projectToPlanningItem", () => {
  it("carries the project icon through", () => {
    expect(projectToPlanningItem({ ...base, iconEmoji: "🚀" })?.iconEmoji).toBe("🚀");
  });

  const base: ProjectPlanningInput = {
    id: "p1",
    name: "Project",
    termSortKey: 30,
    earliestSortKey: 10,
    inPreviousTerm: true,
    decision: null,
    thisTermSpots: {},
    previousTermSpots: { eng: 2 },
  };

  it("is an undecided renewal on last term's spots when no decision exists", () => {
    expect(projectToPlanningItem(base)).toMatchObject({
      source: "renewing",
      state: "Undecided",
      spotsByDomain: { eng: 2 },
    });
  });

  it("is a continuing renewal on this term's spots", () => {
    expect(
      projectToPlanningItem({ ...base, decision: true, thisTermSpots: { eng: 4 } }),
    ).toMatchObject({ source: "renewing", state: "Continuing", spotsByDomain: { eng: 4 } });
  });

  it("drops a project marked not continuing", () => {
    expect(projectToPlanningItem({ ...base, decision: false, thisTermSpots: { eng: 4 } })).toBeNull();
  });

  it("drops an undecided project that was not active last term", () => {
    expect(projectToPlanningItem({ ...base, inPreviousTerm: false })).toBeNull();
  });

  it("keeps a renewal with spots set for the term but no decision undecided, on this term's spots", () => {
    expect(
      projectToPlanningItem({ ...base, thisTermSpots: { eng: 1 }, previousTermSpots: { eng: 3 } }),
    ).toMatchObject({ source: "renewing", state: "Undecided", spotsByDomain: { eng: 1 } });
    expect(projectToPlanningItem({ ...base, inPreviousTerm: false, thisTermSpots: { eng: 1 } })).toMatchObject({
      state: "Undecided",
      spotsByDomain: { eng: 1 },
    });
  });

  it("is a new accepted project when the term is its earliest", () => {
    expect(
      projectToPlanningItem({ ...base, earliestSortKey: 30, thisTermSpots: { eng: 3 } }),
    ).toMatchObject({ source: "new", state: "Accepted", spotsByDomain: { eng: 3 } });
  });

  it("ignores projects that start after the term", () => {
    expect(projectToPlanningItem({ ...base, earliestSortKey: 40, thisTermSpots: { eng: 3 } })).toBeNull();
  });
});

describe("intentSetupState", () => {
  const status = (termId?: string) =>
    ({
      version: 1,
      entries: [{ source: "question", questionKey: "q", role: "intent-status", label: "Status", ...(termId ? { termId } : {}) }],
    }) as never;

  it("is ready once anyone has a status for the term, whatever the setup", () => {
    expect(intentSetupState({ bound: false, mapping: null, submissions: 0, replied: 3 })).toEqual({ kind: "ready" });
  });

  it("says no form is bound", () => {
    expect(intentSetupState({ bound: false, mapping: null, submissions: 0, replied: 0 })).toEqual({ kind: "no-form" });
  });

  it("says the status question isn't mapped, with the submissions waiting on it", () => {
    expect(intentSetupState({ bound: true, mapping: null, submissions: 7, replied: 0 })).toEqual({
      kind: "unmapped",
      submissions: 7,
    });
    expect(
      intentSetupState({ bound: true, mapping: { version: 1, entries: [] } as never, submissions: 0, replied: 0 }),
    ).toEqual({ kind: "unmapped", submissions: 0 });
  });

  it("says submissions exist but none gave a status", () => {
    expect(intentSetupState({ bound: true, mapping: status(), submissions: 4, replied: 0 })).toEqual({
      kind: "no-statuses",
      submissions: 4,
    });
  });

  it("says nobody has responded yet", () => {
    expect(intentSetupState({ bound: true, mapping: status("t27w"), submissions: 0, replied: 0 })).toEqual({
      kind: "no-responses",
    });
  });
});

describe("projectToPlanningItem without spots", () => {
  const base: ProjectPlanningInput = {
    id: "p1",
    name: "Project",
    termSortKey: 30,
    earliestSortKey: 10,
    inPreviousTerm: true,
    decision: null,
    thisTermSpots: {},
    previousTermSpots: {},
  };

  it("keeps an undecided renewal from last term", () => {
    const placed = projectToPlanningItem(base);
    expect(placed).toMatchObject({ source: "renewing", state: "Undecided", spotsByDomain: {} });
    expect(hasSpots(placed!)).toBe(false);
  });

  it("keeps a continuing renewal", () => {
    expect(projectToPlanningItem({ ...base, decision: true })?.state).toBe("Continuing");
  });

  it("keeps a project starting this term", () => {
    expect(projectToPlanningItem({ ...base, earliestSortKey: 30 })).toMatchObject({ source: "new", state: "Accepted" });
  });

  it("drops an older project that was not in the previous term", () => {
    expect(projectToPlanningItem({ ...base, inPreviousTerm: false })).toBeNull();
  });

  it("drops a project marked not continuing", () => {
    expect(projectToPlanningItem({ ...base, decision: false })).toBeNull();
  });

  it("drops an archived project with no spots but keeps one with spots", () => {
    expect(projectToPlanningItem({ ...base, archived: true })).toBeNull();
    expect(projectToPlanningItem({ ...base, archived: true, previousTermSpots: { eng: 2 } })?.state).toBe("Undecided");
  });
});

describe("hasSpots", () => {
  it("ignores zero counts", () => {
    expect(hasSpots({ spotsByDomain: {} })).toBe(false);
    expect(hasSpots({ spotsByDomain: { eng: 0 } })).toBe(false);
    expect(hasSpots({ spotsByDomain: { eng: 1 } })).toBe(true);
  });
});

describe("buildPlanningProjects", () => {
  const items = [
    item({ key: "cont", source: "renewing", state: "Continuing", spotsByDomain: { eng: 3, des: 1 } }),
    item({ key: "und", source: "renewing", state: "Undecided", spotsByDomain: { eng: 2 } }),
    item({ key: "acc", source: "new", state: "Accepted", spotsByDomain: { pm: 1 } }),
    item({ key: "int", source: "new", state: "Interview", spotsByDomain: { des: 2 } }),
  ];
  const listOnlyItems = [
    item({ key: "bare", source: "renewing", state: "Continuing", spotsByDomain: {} }),
    item({ key: "back", source: "new", state: "Backlog", spotsByDomain: { eng: 4 } }),
  ];
  const build = (over: { includePotential?: boolean; includeBacklog?: boolean } = {}) =>
    buildPlanningProjects({
      domains,
      items,
      listOnlyItems,
      includePotential: false,
      includeBacklog: false,
      ...over,
    });

  it("gives each item one row, grouped by source", () => {
    const model = build();
    expect(model.renewing.map((r) => r.key)).toEqual(["bare", "cont", "und"]);
    expect(model.fresh.map((r) => r.key)).toEqual(["acc", "int"]);
  });

  it("names a row's domains, largest first", () => {
    const cont = build().renewing.find((r) => r.key === "cont");
    expect(cont?.spots).toBe(4);
    expect(cont?.domains.map((d) => [d.name, d.count])).toEqual([
      ["Engineering", 3],
      ["Design", 1],
    ]);
  });

  it("shows a no-spots item with zero spots and no domains", () => {
    expect(build().renewing.find((r) => r.key === "bare")).toMatchObject({ spots: 0, domains: [], counted: true });
  });

  it("sorts potential rows after firm ones and leaves them out of totals until included", () => {
    const off = build();
    expect(off.fresh.map((r) => [r.key, r.counted])).toEqual([
      ["acc", true],
      ["int", false],
    ]);
    expect(off.totals).toEqual({ renewing: 4, fresh: 1, spots: 5 });
    expect(build({ includePotential: true }).totals).toEqual({ renewing: 6, fresh: 3, spots: 9 });
  });

  it("only shows Backlog when asked, and counts it as potential", () => {
    expect(build().fresh.some((r) => r.key === "back")).toBe(false);
    expect(build({ includeBacklog: true }).fresh.find((r) => r.key === "back")?.counted).toBe(false);
    expect(build({ includeBacklog: true, includePotential: true }).totals.fresh).toBe(7);
  });

  it("matches the domain view's spot totals when Backlog is off", () => {
    for (const includePotential of [false, true]) {
      const projects = build({ includePotential }).totals;
      const gap = buildPlanningGap({ domains, items, returning: [], includePotential }).totals;
      expect(projects).toEqual({ renewing: gap.renewing, fresh: gap.fresh, spots: gap.spots });
    }
  });

  it("is empty with nothing to show", () => {
    expect(
      buildPlanningProjects({ domains, items: [], listOnlyItems: [], includePotential: true, includeBacklog: true }),
    ).toEqual({ renewing: [], fresh: [], totals: { renewing: 0, fresh: 0, spots: 0 } });
  });
});
