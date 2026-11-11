import { LEGACY_DOMAIN_ID } from "~/lib/prisma-shapes";

type HistoryTerm = { code: string; sortKey: number; startDate: Date };

export type HistoryProjectAssignment = {
  level: string;
  domainId: string;
  project: { name: string };
  domain: { displayName: string };
  term: HistoryTerm;
};

export type HistoryCoreAssignment = {
  leadTitle: string | null;
  term: HistoryTerm;
};

export type MemberHistory = {
  projects: HistoryProjectAssignment[];
  core: HistoryCoreAssignment[];
};

const bySortKey = (a: HistoryTerm, b: HistoryTerm) => a.sortKey - b.sortKey;

export function projectHistoryText(h: MemberHistory): string {
  const termsByProject = new Map<string, HistoryTerm[]>();
  for (const a of h.projects) {
    const terms = termsByProject.get(a.project.name) ?? [];
    if (!terms.some((t) => t.code === a.term.code)) terms.push(a.term);
    termsByProject.set(a.project.name, terms);
  }
  return [...termsByProject.entries()]
    .map(([name, terms]) => ({ name, terms: terms.sort(bySortKey) }))
    .sort(
      (a, b) =>
        b.terms[b.terms.length - 1].sortKey -
          a.terms[a.terms.length - 1].sortKey || a.name.localeCompare(b.name),
    )
    .map((p) => `${p.name} (${p.terms.map((t) => t.code).join(", ")})`)
    .join("; ");
}

export function termsInLabText(h: MemberHistory): string {
  const terms = new Map<string, HistoryTerm>();
  for (const a of [...h.projects, ...h.core]) terms.set(a.term.code, a.term);
  if (terms.size === 0) return "";
  const codes = [...terms.values()].sort(bySortKey).map((t) => t.code);
  return `${codes.length} ${codes.length === 1 ? "term" : "terms"}: ${codes.join(", ")}`;
}

// "Current" is the latest term that has started, so a member already staffed
// for next term still reads as what they are doing now.
export function currentRoleText(h: MemberHistory, now: Date): string {
  const started = [...h.projects, ...h.core]
    .map((a) => a.term)
    .filter((t) => t.startDate <= now);
  if (started.length === 0) return "";
  const latest = started.reduce((a, b) => (b.sortKey > a.sortKey ? b : a));
  const roles: string[] = [];
  for (const a of h.projects) {
    if (a.term.code !== latest.code || a.domainId === LEGACY_DOMAIN_ID) continue;
    const label = `${a.domain.displayName} (${a.level})`;
    if (!roles.includes(label)) roles.push(label);
  }
  for (const c of h.core) {
    if (c.term.code !== latest.code) continue;
    const label = c.leadTitle || "Core";
    if (!roles.includes(label)) roles.push(label);
  }
  return roles.length > 0 ? `${latest.code}: ${roles.join(", ")}` : "";
}

export const MEMBER_HISTORY_COLUMNS = [
  { key: "projectHistory", label: "Project history" },
  { key: "termsInLab", label: "Terms in lab" },
  { key: "currentRole", label: "Current role" },
] as const;

export type MemberHistoryColumn = (typeof MEMBER_HISTORY_COLUMNS)[number]["key"];

export function isMemberHistoryColumn(v: string): v is MemberHistoryColumn {
  return MEMBER_HISTORY_COLUMNS.some((c) => c.key === v);
}

export function memberHistoryText(h: MemberHistory, now: Date): Record<MemberHistoryColumn, string> {
  return {
    projectHistory: projectHistoryText(h),
    termsInLab: termsInLabText(h),
    currentRole: currentRoleText(h, now),
  };
}

export const MEMBER_COLUMNS_PARAM = "member";

export function parseMemberColumns(params: URLSearchParams): MemberHistoryColumn[] {
  const chosen = (params.get(MEMBER_COLUMNS_PARAM) ?? "").split(",");
  return MEMBER_HISTORY_COLUMNS.map((c) => c.key).filter((k) => chosen.includes(k));
}
