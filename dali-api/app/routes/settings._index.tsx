import { useLoaderData } from "react-router";
import { requireAuth } from "~/lib/auth";
import { loadSettingsPageData } from "~/lib/settings-page.server";
import { rotateWalletSecret } from "~/lib/wallet-token";
import { pushWalletPassUpdate } from "~/lib/wallet-apns.server";
import { SettingsPage } from "~/components/settings/SettingsPage";
import type { Route } from "./+types/settings._index";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

// SettingsPage renders its own UnderlineTabButtons row unconditionally, so it
// owns the flush top spacing and the tabless history arrows (same deal as
// calendar) — `areaSubnav`, not the flag-gated `areaPills`.
export const handle = { areaSubnav: true };

export async function loader({ request }: Route.LoaderArgs) {
  return loadSettingsPageData(request);
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { error: "Not authenticated." };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "revoke-wallet-pass") {
    await rotateWalletSecret(auth.user.sub);
    await pushWalletPassUpdate(auth.user.sub);
    return null;
  }
  return { error: "Unknown intent." };
}

export default function SettingsIndex() {
  const data = useLoaderData<typeof loader>();
  if (data instanceof Response) return null;
  return <SettingsPage data={data} />;
}
