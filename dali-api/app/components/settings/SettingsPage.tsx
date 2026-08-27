import { useEffect, useState } from "react";
import { Bell, Cable, KeyRound, Palette } from "lucide-react";
import { useDesktopVersion } from "~/lib/desktop";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { SettingsBlock } from "~/components/settings/SettingsBlock";
import { AppearanceSettingsBlock } from "~/components/settings/AppearanceSettingsBlock";
import { WorkspaceSettingsBlock } from "~/components/settings/WorkspaceSettingsBlock";
import { CalendarSettingsBlock } from "~/components/settings/CalendarSettingsBlock";
import { SlackSettingsBlock } from "~/components/settings/SlackSettingsBlock";
import { SessionsSettingsBlock } from "~/components/settings/SessionsSettingsBlock";
import { ConnectedAppsSettingsBlock } from "~/components/settings/ConnectedAppsSettingsBlock";
import { NotificationsSettingsBlock } from "~/components/settings/NotificationsSettingsBlock";
import type { loadSettingsPageData } from "~/lib/settings-page.server";

const TABS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Cable },
  { id: "devices", label: "Devices", icon: KeyRound },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Sections that used to be their own tab now share one. The old hashes stay
// live — /settings#slack (the settings.slack loader redirect), #devices,
// #connected-apps and friends still land on the right tab, and on a merged
// tab we scroll to the block the hash actually named.
const HASH_TO_TAB: Record<string, TabId> = {
  appearance: "appearance",
  workspace: "appearance",
  notifications: "notifications",
  calendar: "integrations",
  slack: "integrations",
  "connected-apps": "integrations",
  devices: "devices",
};

type SettingsData = Awaited<ReturnType<typeof loadSettingsPageData>>;

export function SettingsPage({
  data,
}: {
  data: Exclude<SettingsData, Response>;
}) {
  const desktopVersion = useDesktopVersion();

  // One tab at a time, Appearance by default. The hash is the source of truth
  // so deep links and back/forward keep working; clicking a tab writes it.
  const [active, setActive] = useState<TabId>("appearance");
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      // A block hash (e.g. "calendar") maps to its tab; a bare tab id (e.g.
      // "integrations", written by a tab click) is itself the tab.
      const tab = HASH_TO_TAB[hash] ?? (TABS.some((t) => t.id === hash) ? (hash as TabId) : undefined);
      if (!tab) return;
      setActive(tab);
      // On a merged tab the hash names a block, not the tab — bring it into view.
      if (hash !== tab) {
        requestAnimationFrame(() =>
          document.getElementById(hash)?.scrollIntoView({ block: "start" }),
        );
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <main className="flex flex-col gap-5">
      <UnderlineTabButtons
        label="Settings"
        items={TABS.map(({ id, label, icon }) => ({
          label,
          icon,
          active: active === id,
          // Writing the hash drives the listener above, so a tab click is a
          // history entry like the old anchor nav was.
          onClick: () => {
            window.location.hash = id;
          },
        }))}
      />

      <div className="flex flex-col gap-4">
        {active === "appearance" && (
          <>
            <SettingsBlock
              id="appearance"
              title="Theme"
              description="Light mode, dark mode, or match your device."
            >
              <AppearanceSettingsBlock />
            </SettingsBlock>
            <SettingsBlock
              id="workspace"
              title="Workspace"
              description="How pages open, and whether to show the sidebar."
            >
              <WorkspaceSettingsBlock hideActivity={data.workspace.hideActivity} />
            </SettingsBlock>
          </>
        )}

        {active === "notifications" && (
          <SettingsBlock
            id="notifications"
            title="Notifications"
            description="Choose how each kind of update reaches you — in-app, email or digest, Slack DM."
          >
            <NotificationsSettingsBlock {...data.notifications} />
          </SettingsBlock>
        )}

        {active === "integrations" && (
          <>
            <SettingsBlock
              id="calendar"
              title="Calendar"
              description="Linked Google accounts and which sub-calendars block your availability."
            >
              <CalendarSettingsBlock calendarLinks={data.calendarLinks} />
            </SettingsBlock>
            <SettingsBlock
              id="slack"
              title="Slack"
              description="Connect Slack so you're added to project channels when staffed."
            >
              <SlackSettingsBlock {...data.slack} />
            </SettingsBlock>
            <SettingsBlock
              id="connected-apps"
              title="Connected apps"
              description="AI assistants and other apps authorized via MCP."
            >
              <ConnectedAppsSettingsBlock grants={data.grants} />
            </SettingsBlock>
          </>
        )}

        {active === "devices" && (
          <SettingsBlock
            id="devices"
            title="Your devices"
            description="Browsers, the desktop app, and connected tools signed in to DALI OS."
          >
            <SessionsSettingsBlock
              sessions={data.sessions}
              currentSessionId={data.currentSessionId}
            />
          </SettingsBlock>
        )}

        {desktopVersion && (
          <p className="mt-6 text-xs text-muted-foreground">
            DALI OS Desktop v{desktopVersion}
          </p>
        )}
      </div>
    </main>
  );
}
