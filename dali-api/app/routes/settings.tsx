import { useEffect } from "react";
import { Outlet, useLoaderData, useLocation, useNavigate, useOutletContext } from "react-router";
import { useDesktopVersion } from "~/lib/desktop";
import { loadSettingsPageData } from "~/lib/settings-page.server";
import { OsSectionHead } from "~/components/os-section";
import { SETTINGS_TABS, settingsRedirectTarget } from "~/components/settings/settings-tabs";
import type { Route } from "./+types/settings";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  return loadSettingsPageData(request);
}

export type SettingsData = Exclude<Awaited<ReturnType<typeof loadSettingsPageData>>, Response>;

export function useSettingsData() {
  return useOutletContext<SettingsData>();
}

export default function SettingsLayout() {
  const data = useLoaderData<typeof loader>() as SettingsData;
  const location = useLocation();
  const navigate = useNavigate();
  const desktopVersion = useDesktopVersion();

  // Hashes never reach the server, so legacy /settings#slack links resolve here.
  useEffect(() => {
    const hash = location.hash.slice(1);
    const target = settingsRedirectTarget(location.pathname, hash);
    if (target) {
      navigate(target, { replace: true });
      return;
    }
    if (!hash) return;
    // Two frames: the shell's scroll restoration resets to the top on the first.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView({ block: "start" }),
      );
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [location.pathname, location.hash, navigate]);

  return (
    <main className="flex flex-col gap-8">
      <OsSectionHead
        title="Settings"
        description="How DALI OS looks, what it tells you about, and what it's connected to. Your profile has its own page."
        tabsLabel="Settings"
        tabs={SETTINGS_TABS}
      />
      <Outlet context={data} />
      {desktopVersion && (
        <p className="text-xs text-os-muted">DALI OS Desktop v{desktopVersion}</p>
      )}
    </main>
  );
}
