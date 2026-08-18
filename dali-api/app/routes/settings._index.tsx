import { useLoaderData } from "react-router";
import { loadSettingsPageData } from "~/lib/settings-page.server";
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

export default function SettingsIndex() {
  const data = useLoaderData<typeof loader>();
  if (data instanceof Response) return null;
  return <SettingsPage data={data} />;
}
