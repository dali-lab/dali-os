import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { ACTIVE_LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { parseColumnMapping } from "~/projects/lib/slot-roles";
import { listActiveCoreMembers, personName, type CoreMemberOption } from "./core-members.server";
import { PLANNING_NOTE_SELECT, toPlanningNoteView, type PlanningNoteView } from "./planning-notes.server";
import { listReturnableProjects, type ReturnableProject } from "./partner-returns.server";
import {
  effectivePi,
  hasSpots,
  intentSetupState,
  projectToPlanningItem,
  type IntentSetup,
  type PlanningItem,
  type PlanningState,
  type ReturningPerson,
} from "./planning-gap";

export type PlanningTermOption = { id: string; code: string; isCurrent: boolean };

// Per-project payload for the planning tab's project info popup. The modal
// only shows this term + later ones (the PI picker drives staffing for the
// upcoming cycle), so `plannedTerms` is pre-filtered to termSortKey ≥ picked.
export type PlanningProjectInfo = {
  description: string | null;
  status: string;
  partnerNames: string[];
  plannedTerms: { id: string; code: string; sortKey: number }[];
  pisByTerm: Record<string, { userId: string; name: string } | null>;
  spotsByTerm: Record<string, { domainId: string; name: string; slots: number }[]>;
  note: PlanningNoteView | null;
};

export type PlanningApplicationInfo = {
  title: string;
  iconEmoji: string | null;
  stage: string;
  partnerName: string | null;
  note: PlanningNoteView | null;
  continues: { projectId: string; name: string; lastTermCode: string | null } | null;
};

export type PlanningData = {
  terms: PlanningTermOption[];
  termId: string | null;
  items: PlanningItem[];
  listOnlyItems: PlanningItem[];
  domains: { id: string; name: string }[];
  spotDomains: { id: string; name: string }[];
  returning: ReturningPerson[];
  replied: number;
  roster: number;
  hasIntentData: boolean;
  intentSetup: IntentSetup;
  projectInfo: Record<string, PlanningProjectInfo>;
  applicationInfo: Record<string, PlanningApplicationInfo>;
  returnableProjects: ReturnableProject[];
  coreMembers: CoreMemberOption[];
};

const APPLICATION_STAGES = ["Backlog", "New", "Interview", "Deciding", "Accepted"] as const;

function addSpots(into: Record<string, number>, domainId: string, n: number) {
  into[domainId] = (into[domainId] ?? 0) + n;
}

function piNameFor(
  projectTerms: { termId: string; pi: Parameters<typeof personName>[0] | null }[],
  sortKeyById: Map<string, number>,
  termSortKey: number,
): string | null {
  const pi = effectivePi(
    projectTerms.map((pt) => ({ sortKey: sortKeyById.get(pt.termId) ?? Infinity, pi: pt.pi })),
    termSortKey,
  );
  return pi ? personName(pi) : null;
}

export async function loadPlanningData(
  requestedTermId: string | null,
  request?: Request,
): Promise<PlanningData> {
  const [allTerms, current] = await Promise.all([
    prisma.term.findMany({
      orderBy: { sortKey: "asc" },
      select: { id: true, code: true, sortKey: true },
    }),
    currentTerm(),
  ]);
  const terms: PlanningTermOption[] = [...allTerms]
    .reverse()
    .map((t) => ({ id: t.id, code: t.code, isCurrent: t.id === current?.id }));

  const currentIdx = allTerms.findIndex((t) => t.id === current?.id);
  const fallback = allTerms[currentIdx + 1] ?? allTerms[currentIdx] ?? allTerms[allTerms.length - 1];
  const term = allTerms.find((t) => t.id === requestedTermId) ?? fallback;
  if (!term) {
    return {
      terms,
      termId: null,
      items: [],
      listOnlyItems: [],
      domains: [],
      spotDomains: [],
      returning: [],
      replied: 0,
      roster: 0,
      hasIntentData: false,
      intentSetup: { kind: "no-form" },
      projectInfo: {},
      applicationInfo: {},
      returnableProjects: [],
      coreMembers: [],
    };
  }
  const prevTerm = [...allTerms].reverse().find((t) => t.sortKey < term.sortKey) ?? null;
  const sortKeyById = new Map(allTerms.map((t) => [t.id, t.sortKey]));

  const [domains, projects, applications, cycle, roster] = await Promise.all([
    prisma.domain.findMany({
      select: { id: true, displayName: true, active: true, isSystem: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.project.findMany({
      where: { projectTerms: { some: { term: { sortKey: { lte: term.sortKey } } } } },
      select: {
        id: true,
        name: true,
        iconEmoji: true,
        status: true,
        description: true,
        projectTerms: {
          select: {
            termId: true,
            pi: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
          },
        },
        partners: {
          where: { endedAt: null },
          select: { partnerOrg: { select: { name: true } } },
        },
        termStatuses: { where: { termId: term.id }, select: { isContinuing: true } },
        planningNote: PLANNING_NOTE_SELECT,
        roleRequests: {
          where: { term: { sortKey: { gte: (prevTerm ?? term).sortKey } } },
          select: { termId: true, domainId: true, slots: true },
        },
      },
    }),
    prisma.partnerApplication.findMany({
      where: {
        resultingProjectId: null,
        stage: { in: [...APPLICATION_STAGES] },
        targetTerms: { some: { termId: term.id } },
      },
      select: {
        id: true,
        title: true,
        iconEmoji: true,
        stage: true,
        pi: { select: { firstName: true, lastName: true, daliEmail: true } },
        domains: { select: { domainId: true, expectedMembers: true } },
        partnerOrg: { select: { name: true } },
        planningNote: PLANNING_NOTE_SELECT,
        continuesProject: {
          select: { id: true, name: true, projectTerms: { select: { term: { select: { code: true, sortKey: true } } } } },
        },
      },
    }),
    prisma.staffingCycle.findUnique({
      where: { termId: term.id },
      select: {
        id: true,
        formBindings: { where: { slot: "intent-to-work" }, select: { columnMapping: true } },
        _count: { select: { formSubmissions: { where: { slot: "intent-to-work" } } } },
      },
    }),
    prisma.user.count({ where: ACTIVE_LAB_MEMBER_WHERE }),
  ]);

  // Per-project payload for the planning tab's info popup. Scoped to the
  // picked term and later so the PI picker drives the staffing cycle the
  // planner is actually looking at; past-term PI stays visible on the project
  // page itself, not in this planning flow.
  const termById = new Map(allTerms.map((t) => [t.id, t]));
  const projectInfo: Record<string, PlanningProjectInfo> = {};
  const domainName = new Map(domains.map((d) => [d.id, d.displayName]));
  for (const p of projects) {
    const upcomingTerms = p.projectTerms
      .map((pt) => termById.get(pt.termId))
      .filter((t): t is (typeof allTerms)[number] => !!t && t.sortKey >= term.sortKey)
      .sort((a, b) => a.sortKey - b.sortKey);
    const pisByTerm: Record<string, { userId: string; name: string } | null> = {};
    for (const ut of upcomingTerms) {
      const pi = effectivePi(
        p.projectTerms.map((pt) => ({
          sortKey: sortKeyById.get(pt.termId) ?? Infinity,
          pi: pt.pi,
        })),
        ut.sortKey,
      );
      pisByTerm[ut.id] = pi ? { userId: pi.id, name: personName(pi) } : null;
    }
    const spotsByTerm: PlanningProjectInfo["spotsByTerm"] = {};
    for (const ut of upcomingTerms) {
      const totals: Record<string, number> = {};
      for (const r of p.roleRequests) if (r.termId === ut.id) addSpots(totals, r.domainId, r.slots);
      spotsByTerm[ut.id] = Object.entries(totals)
        .filter(([, slots]) => slots > 0)
        .map(([domainId, slots]) => ({ domainId, name: domainName.get(domainId) ?? "Unknown domain", slots }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    projectInfo[p.id] = {
      description: p.description,
      status: p.status,
      partnerNames: p.partners.map((l) => l.partnerOrg.name),
      plannedTerms: upcomingTerms.map((t) => ({ id: t.id, code: t.code, sortKey: t.sortKey })),
      pisByTerm,
      spotsByTerm,
      note: toPlanningNoteView(p.planningNote),
    };
  }
  const [coreMembers, returnableProjects] = await Promise.all([
    request ? listActiveCoreMembers(request) : Promise.resolve([]),
    listReturnableProjects(term.sortKey),
  ]);

  const items: PlanningItem[] = [];
  const listOnlyItems: PlanningItem[] = [];
  for (const p of projects) {
    const thisTermSpots: Record<string, number> = {};
    const previousTermSpots: Record<string, number> = {};
    for (const r of p.roleRequests) {
      if (r.termId === term.id) addSpots(thisTermSpots, r.domainId, r.slots);
      else if (r.termId === prevTerm?.id) addSpots(previousTermSpots, r.domainId, r.slots);
    }
    const sortKeys = p.projectTerms
      .map((pt) => sortKeyById.get(pt.termId))
      .filter((k): k is number => k !== undefined);
    const item = projectToPlanningItem({
      id: p.id,
      name: p.name,
      iconEmoji: p.iconEmoji,
      piName: piNameFor(p.projectTerms, sortKeyById, term.sortKey),
      termSortKey: term.sortKey,
      earliestSortKey: sortKeys.length ? Math.min(...sortKeys) : null,
      inPreviousTerm: !!prevTerm && p.projectTerms.some((pt) => pt.termId === prevTerm.id),
      decision: p.termStatuses[0]?.isContinuing ?? null,
      thisTermSpots,
      previousTermSpots,
      archived: p.status === "Archived",
    });
    if (item) (hasSpots(item) ? items : listOnlyItems).push(item);
  }
  const applicationInfo: Record<string, PlanningApplicationInfo> = {};
  for (const a of applications) {
    applicationInfo[a.id] = {
      title: a.title,
      iconEmoji: a.iconEmoji,
      stage: a.stage,
      partnerName: a.partnerOrg?.name ?? null,
      note: toPlanningNoteView(a.planningNote),
      continues: a.continuesProject
        ? {
            projectId: a.continuesProject.id,
            name: a.continuesProject.name,
            lastTermCode:
              [...a.continuesProject.projectTerms].sort((x, y) => y.term.sortKey - x.term.sortKey)[0]?.term.code ?? null,
          }
        : null,
    };
    const spotsByDomain: Record<string, number> = {};
    for (const d of a.domains) if (d.expectedMembers > 0) addSpots(spotsByDomain, d.domainId, d.expectedMembers);
    const item: PlanningItem = {
      key: `application:${a.id}`,
      kind: "application",
      refId: a.id,
      name: a.title,
      iconEmoji: a.iconEmoji,
      piName: a.pi ? personName(a.pi) : null,
      source: "new",
      state: a.stage as PlanningState,
      spotsByDomain,
      ...(a.continuesProject ? { returning: true } : {}),
    };
    (hasSpots(item) ? items : listOnlyItems).push(item);
  }

  let returning: ReturningPerson[] = [];
  let replied = 0;
  if (cycle) {
    const rows = await prisma.intentToWork.findMany({
      where: { staffingCycleId: cycle.id, termId: term.id },
      select: {
        userId: true,
        status: true,
        user: { select: { domainEligibilities: { select: { domainId: true } } } },
      },
    });
    replied = new Set(rows.map((r) => r.userId)).size;
    returning = rows
      .filter((r) => r.status === "Returning")
      .map((r) => ({
        userId: r.userId,
        domainIds: [...new Set(r.user.domainEligibilities.map((e) => e.domainId))],
      }));
  }

  return {
    terms,
    termId: term.id,
    items,
    listOnlyItems,
    domains: domains.filter((d) => !d.isSystem).map((d) => ({ id: d.id, name: d.displayName })),
    spotDomains: domains.filter((d) => d.active && !d.isSystem).map((d) => ({ id: d.id, name: d.displayName })),
    returning,
    replied,
    roster,
    hasIntentData: replied > 0,
    intentSetup: intentSetupState({
      bound: !!cycle && cycle.formBindings.length > 0,
      mapping: cycle?.formBindings[0] ? parseColumnMapping(cycle.formBindings[0].columnMapping) : null,
      submissions: cycle?._count.formSubmissions ?? 0,
      replied,
    }),
    projectInfo,
    applicationInfo,
    returnableProjects,
    coreMembers,
  };
}
