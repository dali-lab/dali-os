import type { Level } from "~/lib/level";

// Client-safe: the Roles & domains page and its loader share these.

export type LabAccess = "none" | "staff" | "admin";

export type AccessMember = {
  id: string;
  name: string;
  email: string | null;
  photoUrl: string | null;
  /** Has a DALIMember row. A few accounts with roles don't. */
  isLabMember: boolean;
  /** Graduated or otherwise not active this term. */
  isAlumni: boolean;
  access: LabAccess;
  /** Admin through the ADMIN_USER_IDS env list, so the page can't remove it. */
  envAdmin: boolean;
  /** Core titles for the current term. A null title is plain Core. */
  coreTitles: { id: string; title: string | null }[];
  domains: DomainMembership[];
  /** Lead assignments from other terms, kept so they can still be removed. */
  otherLeads: { id: string; domainId: string; term: string }[];
};

export type DomainMembership = {
  domainId: string;
  level: Level | null;
  eligibilityId: string | null;
  /** This term's lead assignment, if they lead the domain now. */
  leadAssignmentId: string | null;
};

export type AccessDomain = {
  id: string;
  name: string;
  active: boolean;
  /** A pseudo-domain behind Core cycles; kept off the cards. */
  isSystem: boolean;
  /** What still points at the domain. Empty means it can be deleted. */
  usage: string[];
};

export const ACCESS_OPTIONS: { value: LabAccess; label: string; help: string }[] = [
  { value: "none", label: "Member", help: "Regular lab access." },
  { value: "staff", label: "Staff", help: "Admin access, and exempt from the student checklist." },
  { value: "admin", label: "Admin", help: "Everything in Admin, including payroll and platform settings." },
];

export const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "P1", label: "P1 · Learner" },
  { value: "P2", label: "P2 · Doer" },
  { value: "P3", label: "P3 · Mentor" },
];

export function accessOf(m: { isAdmin: boolean; isStaff: boolean }): LabAccess {
  if (m.isStaff) return "staff";
  return m.isAdmin ? "admin" : "none";
}

/**
 * The one existing role intent that moves someone from one access level to
 * another. Staff implies Admin on the server, so every move is a single write.
 */
export function accessIntent(
  from: LabAccess,
  to: LabAccess,
): { intent: "set-admin" | "set-staff"; value: "true" | "false" } | null {
  if (from === to) return null;
  if (to === "none") return { intent: "set-admin", value: "false" };
  if (to === "staff") return { intent: "set-staff", value: "true" };
  return from === "staff" ? { intent: "set-staff", value: "false" } : { intent: "set-admin", value: "true" };
}

export type RoleFilter = "all" | "admins" | "core" | "leads";

export const ROLE_FILTERS: Record<RoleFilter, (m: AccessMember) => boolean> = {
  all: () => true,
  admins: (m) => m.access !== "none",
  core: (m) => m.coreTitles.length > 0,
  leads: (m) => m.domains.some((d) => d.leadAssignmentId),
};

export function matchesQuery(m: AccessMember, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const titles = m.coreTitles.map((t) => t.title ?? "").join(" ");
  return `${m.name} ${m.email ?? ""} ${titles}`.toLowerCase().includes(q);
}

export function coreLabel(titles: { title: string | null }[]): string {
  return titles.map((t) => t.title ?? "Core").join(", ");
}

/**
 * Eligibility (level) and this term's lead role live in different tables; a
 * row per domain the member is in either way.
 */
export function mergeMemberships(
  eligibilities: { id: string; domainId: string; level: Level }[],
  currentLeads: { id: string; domainId: string }[],
): DomainMembership[] {
  const byDomain = new Map<string, DomainMembership>();
  for (const e of eligibilities) {
    byDomain.set(e.domainId, { domainId: e.domainId, level: e.level, eligibilityId: e.id, leadAssignmentId: null });
  }
  for (const l of currentLeads) {
    const row = byDomain.get(l.domainId) ?? { domainId: l.domainId, level: null, eligibilityId: null, leadAssignmentId: null };
    byDomain.set(l.domainId, { ...row, leadAssignmentId: l.id });
  }
  return [...byDomain.values()];
}

/** People counted on a domain card: current members only, as the old Domains page did. */
export function domainRoster(members: AccessMember[], domainId: string) {
  const people = members.filter((m) => !m.isAlumni && m.domains.some((d) => d.domainId === domainId));
  const membership = (m: AccessMember) => m.domains.find((d) => d.domainId === domainId)!;
  return {
    people,
    leads: people.filter((m) => membership(m).leadAssignmentId),
    byLevel: LEVEL_OPTIONS.map((l) => ({
      level: l.value,
      count: people.filter((m) => membership(m).level === l.value).length,
    })),
  };
}
