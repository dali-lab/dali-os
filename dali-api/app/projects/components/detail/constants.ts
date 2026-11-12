// "Scope" is no longer a public tab — its domain/term/challenge config moved
// into a settings popup (gated to Core/Admin/Staff). Public tabs are just the
// content views. Board and Planning are separate tabs (Linear-style: different
// data gets real navigation); the only sub-controls are display toggles and
// filters, never a second tab level.
const TABS = ["overview", "board", "mentorship"] as const;
export type Tab = (typeof TABS)[number];
export function isTab(x: string | null): x is Tab {
  return (TABS as readonly string[]).includes(x ?? "");
}
export const OS_TABS = ["progress", "drive", "details", "mentorship"] as const;
export type OsTab = (typeof OS_TABS)[number];
export function isOsTab(x: string | null): x is OsTab {
  return (OS_TABS as readonly string[]).includes(x ?? "");
}
export const OS_TAB_LABELS: Record<OsTab, string> = {
  progress: "Progress",
  drive: "Drive",
  details: "Project details",
  mentorship: "Mentorship",
};
export const ACTIVITY_LABELS: Record<string, string> = {
  "projectFile.create": "added a file",
  "projectFile.partner-visibility": "changed a file's partner sharing",
  "page.partner-visibility": "changed a document's partner sharing",
  "page.public-visibility": "changed the public write-up",
  "project.showcase-status": "changed the public showcase status",
  "project.assignment.level": "changed a team member's level",
  "partner.project.link": "linked a partner organization",
  "partner.project.update": "updated partnership dates",
  "partner.project.unlink": "unlinked a partner organization",
};
// Same shape as the home-tab notification timestamps.
export function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
