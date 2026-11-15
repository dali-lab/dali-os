import { Outlet, useLocation, useSearchParams } from "react-router";
import { PageRowControlsScope, PageTabRow } from "~/components/os-page";
import { useOsChrome } from "~/components/os-chrome";
import { PartnerSettingsModal } from "../components/PartnerSettingsModal";
import { partnerCrmTabs } from "../components/PartnerCrmNav";
import { boardPrefsFromParams, writeBoardPrefsParams } from "../lib/partner-board";

export default function PartnersCrmLayout() {
  const os = useOsChrome();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsOpen = searchParams.get("settings") === "1";

  const setSettings = (open: boolean) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (open) next.set("settings", "1");
        else next.delete("settings");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const board =
    pathname === "/core/partners"
      ? {
          prefs: boardPrefsFromParams(searchParams),
          onChange: (next: ReturnType<typeof boardPrefsFromParams>) =>
            setSearchParams((prev) => writeBoardPrefsParams(prev, next), {
              replace: true,
              preventScrollReset: true,
            }),
        }
      : undefined;

  return (
    <PageRowControlsScope>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className={os.pageTitle}>Partners</h1>
          <p className={os.bodyText}>Applications, renewals and term planning for partner projects</p>
        </header>
        <PageTabRow
          label="Partners"
          tabs={partnerCrmTabs(pathname)}
          onSettings={() => setSettings(true)}
          settingsLabel="Partner settings"
          settingsActive={settingsOpen}
        />
        {settingsOpen && <PartnerSettingsModal onClose={() => setSettings(false)} board={board} />}
        <Outlet />
      </div>
    </PageRowControlsScope>
  );
}
