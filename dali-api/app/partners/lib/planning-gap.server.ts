import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { ACTIVE_LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { parseColumnMapping, type ColumnMapping } from "~/projects/lib/slot-roles";
import { interpretIntentForm } from "~/projects/lib/intent-form-interpreter";
import { listActiveCoreMembers, personName, type CoreMemberOption } from "~/lib/core-members.server";
import { PLANNING_NOTE_SELECT, toPlanningNoteView, type PlanningNoteView } from "./planning-notes.server";
import { listReturnableProjects, type ReturnableProject } from "./partner-returns.server";
import type { MaintenancePlan } from "~/generated/prisma/enums";
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
  spotsByTerm: Record<string, PlanningSpot[]>;
  note: PlanningNoteView | null;
  // Set when nothing is planned from the picked term on (an undecided
  // renewal): the project's last term, its PI and spots, so the popup can
  // still show and assign the PI that carries forward if it continues.
  lastTerm: { id: string; code: string; pi: PlanningPerson | null; spots: PlanningSpot[] } | null;
  maintenance: { plan: MaintenancePlan; feeCents: number | null } | null;
};

export type PlanningMaintainingRow = {
  projectId: string;
  name: string;
  iconEmoji: string | null;
  plan: MaintenancePlan;
  piName: string | null;
};

export type PlanningSpot = { domainId: string; name: string; slots: number };
export type PlanningPerson = { userId: string; name: string };

export type PlanningApplicationInfo = {
  title: string;
  iconEmoji: string | null;
  stage: string;
  partnerName: string | null;
  note: PlanningNoteView | null;
  continues: { projectId: string; name: string; lastTermCode: string | null } | null;
  summary: string | null;
  pi: PlanningPerson | null;
  targetTermCodes: string[];
  spots: PlanningSpot[];
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
  maintaining: PlanningMaintainingRow[];
  coreMembers: CoreMemberOption[];
};

const APPLICATION_STAGES = ["Backlog", "New", "Interview", "Deciding", "Accepted"] as const;

function addSpots(into: Record<string, number>, domainId: string, n: number) {
  into[domainId] = (into[domainId] ?? 0) + n;
}

function spotList(totals: Record<string, number>, names: Map<string, string>): PlanningSpot[] {
  return Object.entries(totals)
    .filter(([, slots]) => slots > 0)
    .map(([domainId, slots]) => ({ domainId, name: names.get(domainId) ?? "Unknown domain", slots }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
      maintaining: [],
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
        maintenancePlans: {
          where: { endedAt: null },
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { plan: true, feeCents: true },
        },
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
        summary: true,
        pi: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
        domains: { select: { domainId: true, expectedMembers: true } },
        targetTerms: { select: { term: { select: { code: true, sortKey: true } } } },
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
    const piAt = (sortKey: number): PlanningPerson | null => {
      const pi = effectivePi(
        p.projectTerms.map((pt) => ({ sortKey: sortKeyById.get(pt.termId) ?? Infinity, pi: pt.pi })),
        sortKey,
      );
      return pi ? { userId: pi.id, name: personName(pi) } : null;
    };
    const spotsIn = (termId: string): PlanningSpot[] => {
      const totals: Record<string, number> = {};
      for (const r of p.roleRequests) if (r.termId === termId) addSpots(totals, r.domainId, r.slots);
      return spotList(totals, domainName);
    };
    const pisByTerm: Record<string, PlanningPerson | null> = {};
    const spotsByTerm: PlanningProjectInfo["spotsByTerm"] = {};
    for (const ut of upcomingTerms) {
      pisByTerm[ut.id] = piAt(ut.sortKey);
      spotsByTerm[ut.id] = spotsIn(ut.id);
    }
    const last =
      upcomingTerms.length === 0
        ? p.projectTerms
            .map((pt) => termById.get(pt.termId))
            .filter((t): t is (typeof allTerms)[number] => !!t)
            .sort((a, b) => b.sortKey - a.sortKey)[0]
        : undefined;
    projectInfo[p.id] = {
      description: p.description,
      status: p.status,
      partnerNames: p.partners.map((l) => l.partnerOrg.name),
      plannedTerms: upcomingTerms.map((t) => ({ id: t.id, code: t.code, sortKey: t.sortKey })),
      pisByTerm,
      spotsByTerm,
      note: toPlanningNoteView(p.planningNote),
      lastTerm: last ? { id: last.id, code: last.code, pi: piAt(last.sortKey), spots: spotsIn(last.id) } : null,
      maintenance: p.maintenancePlans[0] ?? null,
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
      summary: a.summary,
      pi: a.pi ? { userId: a.pi.id, name: personName(a.pi) } : null,
      targetTermCodes: [...a.targetTerms].sort((x, y) => x.term.sortKey - y.term.sortKey).map((t) => t.term.code),
      spots: [],
    };
    const spotsByDomain: Record<string, number> = {};
    for (const d of a.domains) if (d.expectedMembers > 0) addSpots(spotsByDomain, d.domainId, d.expectedMembers);
    applicationInfo[a.id].spots = spotList(spotsByDomain, domainName);
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

  const intentMapping = cycle?.formBindings[0] ? parseColumnMapping(cycle.formBindings[0].columnMapping) : null;
  const { returning, replied } = cycle
    ? await loadIntentFromSubmissions({
        cycleId: cycle.id,
        cycleTermId: term.id,
        mapping: intentMapping,
        allTermIds: allTerms.map((t) => t.id),
      })
    : { returning: [] as ReturningPerson[], replied: 0 };

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
      mapping: intentMapping,
      submissions: cycle?._count.formSubmissions ?? 0,
      replied,
    }),
    projectInfo,
    applicationInfo,
    returnableProjects,
    maintaining: projects
      .filter((p) => p.maintenancePlans.length > 0)
      .map((p) => ({
        projectId: p.id,
        name: p.name,
        iconEmoji: p.iconEmoji,
        plan: p.maintenancePlans[0].plan,
        piName: piNameFor(p.projectTerms, sortKeyById, term.sortKey),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    coreMembers,
  };
}

// Who intends to work the planned term, read from each member's latest
// intent-to-work submission with the binding's current mapping: the same
// answers the Intent to Work page lists. IntentToWork rows are only written
// when the mapping was valid at submit time, so they can lag the answers.
export async function loadIntentFromSubmissions(input: {
  cycleId: string;
  cycleTermId: string;
  mapping: ColumnMapping | null;
  allTermIds: string[];
}): Promise<{ returning: ReturningPerson[]; replied: number }> {
  const submissions = await prisma.formSubmission.findMany({
    where: { staffingCycleId: input.cycleId, slot: "intent-to-work", userId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      userId: true,
      answers: true,
      user: { select: { domainEligibilities: { select: { domainId: true } } } },
    },
  });
  const latest = new Map<string, (typeof submissions)[number]>();
  for (const sub of submissions) if (sub.userId && !latest.has(sub.userId)) latest.set(sub.userId, sub);

  const returning: ReturningPerson[] = [];
  let replied = 0;
  for (const [userId, sub] of latest) {
    if (!input.mapping) continue;
    const answers = sub.answers && typeof sub.answers === "object" ? (sub.answers as Record<string, unknown>) : {};
    const result = interpretIntentForm(answers, input.mapping, input.allTermIds, input.cycleTermId);
    if (!result.ok) continue;
    const forTerm = result.rows.find((r) => r.termId === input.cycleTermId);
    if (!forTerm) continue;
    replied += 1;
    if (forTerm.status !== "Returning") continue;
    returning.push({
      userId,
      domainIds: [...new Set(sub.user?.domainEligibilities.map((e) => e.domainId) ?? [])],
    });
  }
  return { returning, replied };
}
