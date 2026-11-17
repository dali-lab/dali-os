import { useState } from "react";
import { useLoaderData } from "react-router";
import { requireAuth } from "~/lib/auth";
import { listContactEmailOptions, runContactEmailIntent } from "~/lib/contact-email.server";
import { ContactEmailPicker } from "~/components/contact-email/ContactEmailPicker";
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

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { contactEmail: { options: [], preselected: null } };
  return { contactEmail: await listContactEmailOptions(auth.user.sub) };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { error: "Not authenticated." };
  const form = await request.formData();
  return (await runContactEmailIntent(String(form.get("intent") ?? ""), form, auth.user.sub, request)) ?? {
    error: "Unknown intent.",
  };
}

export default function SettingsSecurity() {
  const data = useSettingsData();
  const { contactEmail } = useLoaderData<typeof loader>();
  const passkeys = usePasskeys();
  const [saved, setSaved] = useState(false);
  const current = contactEmail.options.find((o) => o.current)?.address ?? null;
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        id="contact-email"
        title="Sign-in and contact email"
        description="Sign-in codes and DALI OS updates go to this address."
      >
        <ContactEmailPicker
          key={current ?? "none"}
          data={contactEmail}
          initial={current}
          submitLabel="Save"
          onDone={() => setSaved(true)}
          secondary={saved ? <span role="status" className="text-sm text-os-grey">Saved</span> : null}
        />
      </SettingsSection>
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
