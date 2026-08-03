import { useEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";
import {
  Bell,
  CalendarDays,
  Cable,
  FileSignature,
  KeyRound,
  Palette,
  PanelTop,
  Slack,
  UserCircle2,
} from "lucide-react";
import { useDesktopVersion } from "~/lib/desktop";
import { SettingsBlock, SettingsLayout } from "~/components/settings/SettingsLayout";
import { AccountSettingsBlock } from "~/components/settings/AccountSettingsBlock";
import { AppearanceSettingsBlock } from "~/components/settings/AppearanceSettingsBlock";
import { WorkspaceSettingsBlock } from "~/components/settings/WorkspaceSettingsBlock";
import { CalendarSettingsBlock } from "~/components/settings/CalendarSettingsBlock";
import { SlackSettingsBlock } from "~/components/settings/SlackSettingsBlock";
import { SessionsSettingsBlock } from "~/components/settings/SessionsSettingsBlock";
import { ConnectedAppsSettingsBlock } from "~/components/settings/ConnectedAppsSettingsBlock";
import { NotificationsSettingsBlock } from "~/components/settings/NotificationsSettingsBlock";
import { AgreementsSettingsBlock } from "~/components/settings/AgreementsSettingsBlock";
import type { loadSettingsPageData } from "~/lib/settings-page.server";

const SECTION_IDS = [
  "account",
  "appearance",
  "workspace",
  "calendar",
  "slack",
  "notifications",
  "agreements",
  "devices",
  "connected-apps",
] as const;
type SectionId = (typeof SECTION_IDS)[number];

const NAV = [
  { id: "account", label: "Account", icon: UserCircle2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "workspace", label: "Workspace", icon: PanelTop },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "slack", label: "Slack", icon: Slack },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "agreements", label: "Agreements", icon: FileSignature },
  { id: "devices", label: "Your devices", icon: KeyRound },
  { id: "connected-apps", label: "Connected apps", icon: Cable },
] as const;

function sectionFromHash(): SectionId | null {
  const hash = window.location.hash.slice(1);
  return (SECTION_IDS as readonly string[]).includes(hash)
    ? (hash as SectionId)
    : null;
}

type SettingsData = Awaited<ReturnType<typeof loadSettingsPageData>>;

export function SettingsPage({
  data,
  actionError,
}: {
  data: Exclude<SettingsData, Response>;
  actionError?: string | null;
}) {
  const desktopVersion = useDesktopVersion();
  const navigation = useNavigation();
  const wasSubmitting = useRef(false);

  // One section at a time, Account by default. The hash is the source of
  // truth so old deep links (/settings#devices, /settings#connected-apps
  // redirects) and back/forward keep working.
  const [active, setActive] = useState<SectionId>("account");
  useEffect(() => {
    const sync = () => {
      const section = sectionFromHash();
      if (section) setActive(section);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (navigation.state === "submitting") {
      wasSubmitting.current = true;
      return;
    }
    if (navigation.state === "idle" && wasSubmitting.current) {
      wasSubmitting.current = false;
      if (
        !actionError &&
        typeof window !== "undefined" &&
        window.parent !== window
      ) {
        window.parent.postMessage(
          { type: "dali:profileUpdated" },
          window.location.origin,
        );
      }
    }
  }, [navigation.state, actionError]);

  return (
    <main className="max-w-4xl">
      <header className="mb-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
      </header>

      <SettingsLayout nav={[...NAV]} active={active}>
        {active === "account" && (
          <SettingsBlock
            id="account"
            title="Account"
            description="Name, pronouns, emails, photo, class year, and major."
          >
            <AccountSettingsBlock profile={data.profile} />
          </SettingsBlock>
        )}

        {active === "calendar" && (
          <SettingsBlock
            id="calendar"
            title="Calendar"
            description="Linked Google accounts and which sub-calendars block your availability."
          >
            <CalendarSettingsBlock calendarLinks={data.calendarLinks} />
          </SettingsBlock>
        )}

        {active === "workspace" && (
          <SettingsBlock
            id="workspace"
            title="Workspace"
            description="How pages open, and whether to show the sidebar."
          >
            <WorkspaceSettingsBlock hideActivity={data.workspace.hideActivity} />
          </SettingsBlock>
        )}
        {active === "slack" && (
          <SettingsBlock
            id="slack"
            title="Slack"
            description="Connect Slack so you're added to project channels when staffed."
          >
            <SlackSettingsBlock {...data.slack} />
          </SettingsBlock>
        )}
        {active === "appearance" && (
          <SettingsBlock
            id="appearance"
            title="Appearance"
            description="Light mode, dark mode, or match your device."
          >
            <AppearanceSettingsBlock />
          </SettingsBlock>
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

        {active === "agreements" && (
          <SettingsBlock
            id="agreements"
            title="Agreements"
            description="Lab agreements you've signed, and any still awaiting your signature."
          >
            <AgreementsSettingsBlock
              outstanding={data.agreements.outstanding}
              signed={data.agreements.signed}
            />
          </SettingsBlock>
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

        {active === "connected-apps" && (
          <SettingsBlock
            id="connected-apps"
            title="Connected apps"
            description="AI assistants and other apps authorized via MCP."
          >
            <ConnectedAppsSettingsBlock grants={data.grants} />
          </SettingsBlock>
        )}
      </SettingsLayout>

      {desktopVersion && (
        <p className="mt-10 text-xs text-muted-foreground">
          DALI OS Desktop v{desktopVersion}
        </p>
      )}
    </main>
  );
}
