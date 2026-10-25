import { requireAuth } from "~/lib/auth";
import { rotateWalletSecret } from "~/lib/wallet-token";
import { pushWalletPassUpdate } from "~/lib/wallet-apns.server";
import { SettingsSection } from "~/components/settings/SettingsSection";
import { AppearanceSettingsBlock } from "~/components/settings/AppearanceSettingsBlock";
import {
  PresenceSettingsBlock,
  WorkspaceSettingsBlock,
} from "~/components/settings/WorkspaceSettingsBlock";
import { WalletSettingsBlock } from "~/components/settings/WalletSettingsBlock";
import { useSettingsData } from "./settings";
import type { Route } from "./+types/settings.general";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { error: "Not authenticated." };
  const form = await request.formData();
  if (form.get("intent") === "revoke-wallet-pass") {
    await rotateWalletSecret(auth.user.sub);
    await pushWalletPassUpdate(auth.user.sub);
    return null;
  }
  return { error: "Unknown intent." };
}

export default function SettingsGeneral() {
  const data = useSettingsData();
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection id="appearance" title="Appearance" description="Applies on this device only.">
        <AppearanceSettingsBlock />
      </SettingsSection>
      <SettingsSection
        id="workspace"
        title="Workspace"
        description="How pages open and what stays on screen while you work."
      >
        <WorkspaceSettingsBlock />
      </SettingsSection>
      <SettingsSection id="presence" title="Presence" description="What other lab members can see about you.">
        <PresenceSettingsBlock hideActivity={data.workspace.hideActivity} />
      </SettingsSection>
      <SettingsSection
        id="membership-pass"
        title="Membership pass"
        description="Your DALI pass for event check-in, kept in your phone's wallet."
      >
        <WalletSettingsBlock wallet={data.wallet} />
      </SettingsSection>
    </div>
  );
}
