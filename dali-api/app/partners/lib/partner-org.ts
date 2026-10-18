// Shared PartnerOrg vocabulary + pure helpers for the account 360 pages
// (spec §7). Mirrors the convention in lib/partner-application.ts: one source
// of truth for labels and derived state, imported by the org route, the
// directory, and the MCP tools.

import type { PartnerOrgType } from "~/generated/prisma/enums";

export const PARTNER_ORG_TYPES: PartnerOrgType[] = [
  "DartmouthDepartment",
  "FacultyResearch",
  "Startup",
  "Nonprofit",
  "Company",
  "Alumni",
  "Other",
];

export const PARTNER_ORG_TYPE_LABELS: Record<PartnerOrgType, string> = {
  DartmouthDepartment: "Dartmouth department",
  FacultyResearch: "Faculty research",
  Startup: "Startup",
  Nonprofit: "Nonprofit",
  Company: "Company",
  Alumni: "Alumni",
  Other: "Other",
};

export function isPartnerOrgType(x: unknown): x is PartnerOrgType {
  return typeof x === "string" && (PARTNER_ORG_TYPES as string[]).includes(x);
}

// ─── Relationship status ────────────────────────────────────────────────────
// Derived, never stored: Active when any ProjectPartner link is still open,
// Past when every link has ended, Prospect when there are no links at all,
// and Dormant narrows Past further once the org has gone quiet for a year.

export const PARTNER_RELATIONSHIP_STATUSES = [
  "Active",
  "Past",
  "Prospect",
  "Dormant",
] as const;

export type PartnerRelationshipStatus = (typeof PARTNER_RELATIONSHIP_STATUSES)[number];

export const PARTNER_RELATIONSHIP_STATUS_LABELS: Record<PartnerRelationshipStatus, string> = {
  Active: "Active",
  Past: "Past",
  Prospect: "Prospect",
  Dormant: "Dormant",
};

export const PARTNER_RELATIONSHIP_STATUS_PILL: Record<PartnerRelationshipStatus, string> = {
  Active: "bg-accent-teal/15 text-accent-teal",
  Past: "bg-muted text-muted-foreground",
  Prospect: "bg-accent-coral/15 text-accent-coral",
  Dormant: "bg-destructive/10 text-destructive",
};

const DORMANT_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

export function partnerRelationshipStatus(input: {
  projectLinks: { endedAt: Date | string | null }[];
  lastActivityAt: Date | string | null;
  now?: Date;
}): PartnerRelationshipStatus {
  const now = input.now ?? new Date();

  if (input.projectLinks.length === 0) return "Prospect";
  if (input.projectLinks.some((p) => p.endedAt === null)) return "Active";

  // Past, unless it's been quiet long enough to read as Dormant.
  if (!input.lastActivityAt) return "Dormant";
  const ageMs = now.getTime() - new Date(input.lastActivityAt).getTime();
  return ageMs > DORMANT_AFTER_MS ? "Dormant" : "Past";
}

// ─── Merge planning ──────────────────────────────────────────────────────────
// Pure dedup logic for folding one org into another (spec §7 Directory /
// §13). Memberships are unique on (contactId, orgId) and ProjectPartner is
// unique on (projectId, partnerOrgId) at the survivor, so a straight repoint
// of every row would throw P2002 on any contact or project the survivor
// already has. This decides, for each row, repoint vs. leave-for-cleanup.
//
// Memberships that collide are left alone: PartnerMembership.org cascades on
// delete, so once the source org is deleted they disappear with it.
// ProjectPartner has no cascade (it would block deleting an org that still
// references a project), so a colliding link has to be explicitly removed
// before the delete, not merely skipped.

export type OrgMergePlan = {
  membershipIdsToRepoint: string[];
  projectLinkIdsToRepoint: string[];
  projectLinkIdsToRemove: string[];
};

export function planOrgMerge(input: {
  sourceMemberships: { id: string; contactId: string }[];
  survivorContactIds: string[];
  sourceProjectLinks: { id: string; projectId: string }[];
  survivorProjectIds: string[];
}): OrgMergePlan {
  const survivorContacts = new Set(input.survivorContactIds);
  const membershipIdsToRepoint = input.sourceMemberships
    .filter((m) => !survivorContacts.has(m.contactId))
    .map((m) => m.id);

  const survivorProjects = new Set(input.survivorProjectIds);
  const projectLinkIdsToRepoint: string[] = [];
  const projectLinkIdsToRemove: string[] = [];
  for (const link of input.sourceProjectLinks) {
    if (survivorProjects.has(link.projectId)) projectLinkIdsToRemove.push(link.id);
    else projectLinkIdsToRepoint.push(link.id);
  }

  return { membershipIdsToRepoint, projectLinkIdsToRepoint, projectLinkIdsToRemove };
}
