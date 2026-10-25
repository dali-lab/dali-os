import { Link } from "react-router";
import { SettingsSection } from "~/components/settings/SettingsSection";
import {
  AddGoogleAccountButton,
  CalendarSettingsBlock,
} from "~/components/settings/CalendarSettingsBlock";
import { SlackSettingsBlock } from "~/components/settings/SlackSettingsBlock";
import { ConnectedAppsSettingsBlock } from "~/components/settings/ConnectedAppsSettingsBlock";
import { useSettingsData } from "./settings";
import type { Route } from "./+types/settings.connections";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export default function SettingsConnections() {
  const data = useSettingsData();
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        id="calendar"
        title="Google Calendar"
        description="Accounts whose calendars show up in Calendar. Pick which calendars are visible from Calendar itself."
        action={<AddGoogleAccountButton />}
      >
        <CalendarSettingsBlock calendarLinks={data.calendarLinks} />
      </SettingsSection>
      <SettingsSection
        id="slack"
        title="Slack"
        description="Lets DALI OS send you DMs and add you to project channels when you're staffed."
      >
        <SlackSettingsBlock {...data.slack} />
      </SettingsSection>
      <SettingsSection
        id="connected-apps"
        title="AI & connected apps"
        description="Tools you've let read or act on DALI OS for you, like Claude over MCP."
        action={
          <Link to="/help/mcp" className="text-sm text-os-accent transition-colors hover:text-os-accent-hover">
            How to connect Claude
          </Link>
        }
      >
        <ConnectedAppsSettingsBlock grants={data.grants} />
      </SettingsSection>
    </div>
  );
}
