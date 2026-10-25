import { SettingsSection } from "~/components/settings/SettingsSection";
import {
  AddPasskeyButton,
  PasskeysList,
  usePasskeys,
} from "~/components/settings/PasskeysSettingsBlock";
import {
  SessionsSettingsBlock,
  SignOutOthersButton,
} from "~/components/settings/SessionsSettingsBlock";
import { useSettingsData } from "./settings";
import type { Route } from "./+types/settings.security";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export default function SettingsSecurity() {
  const data = useSettingsData();
  const passkeys = usePasskeys();
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        id="passkeys"
        title="Passkeys"
        description="Sign in with Face ID, Touch ID, or a security key. Add one on each device you use."
        action={<AddPasskeyButton state={passkeys} />}
      >
        <PasskeysList state={passkeys} />
      </SettingsSection>
      <SettingsSection
        id="devices"
        title="Where you're signed in"
        description="Browsers, the desktop app, and connected apps with an active session."
        action={
          <SignOutOthersButton sessions={data.sessions} currentSessionId={data.currentSessionId} />
        }
      >
        <SessionsSettingsBlock sessions={data.sessions} currentSessionId={data.currentSessionId} />
      </SettingsSection>
    </div>
  );
}
