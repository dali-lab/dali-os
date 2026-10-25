import type { OsTab } from "~/components/os-section";

export type SettingsTabKey = "general" | "notifications" | "connections" | "security";

export const SETTINGS_TABS: (OsTab & { key: SettingsTabKey })[] = [
  { key: "general", label: "General", to: "/settings/general" },
  { key: "notifications", label: "Notifications", to: "/settings/notifications" },
  { key: "connections", label: "Connections", to: "/settings/connections" },
  { key: "security", label: "Sign-in & security", to: "/settings/security" },
];

// Settings used to be one page with hash-addressed sections, and old links
// (help pages, emails, bookmarks) still carry those hashes. Each maps to the
// tab that now holds the section; the section keeps its id for scrolling.
const HASH_TO_TAB: Record<string, SettingsTabKey> = {
  general: "general",
  appearance: "general",
  workspace: "general",
  presence: "general",
  "membership-pass": "general",
  notifications: "notifications",
  integrations: "connections",
  connections: "connections",
  calendar: "connections",
  slack: "connections",
  "connected-apps": "connections",
  devices: "security",
  security: "security",
  passkeys: "security",
};

/** Section ids rendered on the tabs, so a hash naming one can scroll to it. */
export const SETTINGS_SECTION_IDS = new Set([
  "appearance",
  "workspace",
  "presence",
  "membership-pass",
  "calendar",
  "slack",
  "connected-apps",
  "passkeys",
  "devices",
]);

/**
 * Where a settings URL should go instead, or null to stay. `hash` is without
 * the leading "#".
 */
export function settingsRedirectTarget(pathname: string, hash: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  const tab = HASH_TO_TAB[hash];
  if (tab) {
    const section = SETTINGS_SECTION_IDS.has(hash) ? `#${hash}` : "";
    return path === `/settings/${tab}` ? null : `/settings/${tab}${section}`;
  }
  return path === "/settings" ? "/settings/general" : null;
}
