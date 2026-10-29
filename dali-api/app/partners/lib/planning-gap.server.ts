import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { ACTIVE_LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import {
  projectToPlanningItem,
  type PlanningItem,
  type PlanningState,
  type ReturningPerson,
} from "./planning-gap";

export type PlanningTermOption = { id: string; code: string; isCurrent: boolean };

export type PlanningData = {
  terms: PlanningTermOption[];
  termId: string | null;
  items: PlanningItem[];
  domains: { id: string; name: string }[];
  returning: ReturningPerson[];
  replied: number;
  roster: number;
  hasIntentData: boolean;
};

const APPLICATION_STAGES = ["New", "Interview", "Deciding", "Accepted"] as const;

function addSpots(into: Record<string, number>, domainId: string, n: number) {
  into[domainId] = (into[domainId] ?? 0) + n;
}

export async function loadPlanningData(requestedTermId: string | null): Promise<PlanningData> {
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
    return { terms, termId: null, items: [], domains: [], returning: [], replied: 0, roster: 0, hasIntentData: false };
  }
  const prevTerm = [...allTerms].reverse().find((t) => t.sortKey < term.sortKey) ?? null;
  const sortKeyById = new Map(allTerms.map((t) => [t.id, t.sortKey]));

  const [domains, projects, applications, cycle, roster] = await Promise.all([
    prisma.domain.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
    prisma.project.findMany({
      where: { projectTerms: { some: { term: { sortKey: { lte: term.sortKey } } } } },
      select: {
        id: true,
        name: true,
        projectTerms: { select: { termId: true } },
        termStatuses: { where: { termId: term.id }, select: { isContinuing: true } },
        roleRequests: {
          where: { termId: { in: [term.id, ...(prevTerm ? [prevTerm.id] : [])] } },
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
        stage: true,
        domains: { select: { domainId: true, expectedMembers: true } },
      },
    }),
    prisma.staffingCycle.findUnique({ where: { termId: term.id }, select: { id: true } }),
    prisma.user.count({ where: ACTIVE_LAB_MEMBER_WHERE }),
  ]);

  const items: PlanningItem[] = [];
  for (const p of projects) {
    const thisTermSpots: Record<string, number> = {};
    const previousTermSpots: Record<string, number> = {};
    for (const r of p.roleRequests) {
      addSpots(r.termId === term.id ? thisTermSpots : previousTermSpots, r.domainId, r.slots);
    }
    const sortKeys = p.projectTerms
      .map((pt) => sortKeyById.get(pt.termId))
      .filter((k): k is number => k !== undefined);
    const item = projectToPlanningItem({
      id: p.id,
      name: p.name,
      termSortKey: term.sortKey,
      earliestSortKey: sortKeys.length ? Math.min(...sortKeys) : null,
      inPreviousTerm: !!prevTerm && p.projectTerms.some((pt) => pt.termId === prevTerm.id),
      decision: p.termStatuses[0]?.isContinuing ?? null,
      thisTermSpots,
      previousTermSpots,
    });
    if (item) items.push(item);
  }
  for (const a of applications) {
    const spotsByDomain: Record<string, number> = {};
    for (const d of a.domains) if (d.expectedMembers > 0) addSpots(spotsByDomain, d.domainId, d.expectedMembers);
    if (Object.keys(spotsByDomain).length === 0) continue;
    items.push({
      key: `application:${a.id}`,
      kind: "application",
      refId: a.id,
      name: a.title,
      source: "new",
      state: a.stage as PlanningState,
      spotsByDomain,
    });
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
    domains: domains.map((d) => ({ id: d.id, name: d.displayName })),
    returning,
    replied,
    roster,
    hasIntentData: replied > 0,
  };
}
