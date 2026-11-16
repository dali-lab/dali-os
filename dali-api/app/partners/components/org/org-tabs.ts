export function memberName(c: { name: string; email: string | null }) {
  return c.name || c.email || "Unnamed";
}

export const ORG_TAB_VALUES = [
  "timeline",
  "contacts",
  "applications",
  "projects",
  "finance",
  "settings",
] as const;
export type OrgTab = (typeof ORG_TAB_VALUES)[number];
export function isOrgTab(x: string | null): x is OrgTab {
  return !!x && (ORG_TAB_VALUES as readonly string[]).includes(x);
}

export const ORG_TAB_LABELS: Record<OrgTab, string> = {
  timeline: "Timeline",
  contacts: "Contacts",
  applications: "Applications",
  projects: "Projects",
  finance: "Finance",
  settings: "Settings",
};
