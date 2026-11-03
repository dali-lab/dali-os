import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { cn } from "~/lib/cn";
import {
  readEmojiSuggestionsPreference,
  setEmojiSuggestionsPreference,
} from "~/lib/emoji-suggestions";
import { Toggle } from "~/components/ui/Toggle";
import { useToast } from "~/components/ui/toast";
import { SettingRow } from "~/components/settings/SettingsSection";
import { TabsPreview } from "~/components/settings/TabsPreview";
import { useDesktopVersion } from "~/lib/desktop";
import { useIsBrowserDesktopCandidate } from "~/lib/desktop-candidate";
import { buttonClasses } from "~/components/ui/Button";
import { readOpenInAppCookie, writeOpenInAppCookie } from "~/lib/open-in-app-pref";
import { readTabStripCookie, tabsPreferred, writeTabStripCookie } from "~/lib/desktop-tabs-pref";

const TAB_MODES = [
  { tabs: true, label: "Tabs" },
  { tabs: false, label: "No tabs" },
] as const;

// The tab-strip pref changes the server-rendered shell, so applying it reloads.
function reloadSettings() {
  window.location.replace("/settings/general");
}

export function WorkspaceSettingsBlock() {
  // Render defaults on the server, then correct to the cookie-backed values on
  // mount to avoid a hydration mismatch.
  const [emoji, setEmoji] = useState(false);
  const toast = useToast();
  const inDesktopApp = useDesktopVersion() !== null;
  const inBrowser = useIsBrowserDesktopCandidate();
  const [showTabs, setShowTabs] = useState(true);
  const [openInApp, setOpenInApp] = useState(false);

  useEffect(() => {
    setShowTabs(tabsPreferred(readTabStripCookie()));
    setOpenInApp(readOpenInAppCookie());
    setEmoji(readEmojiSuggestionsPreference());
  }, []);

  return (
    <div className="rounded-os-card bg-os-card divide-y divide-os-container/70">
      {inDesktopApp && (
        <div className="flex flex-col gap-3 px-6 py-5">
          <div>
            <p className="text-[15px] text-foreground">Tabs</p>
            <p className="mt-0.5 text-sm text-os-grey">Open pages in tabs above the page. Saved on this device. Reloads DALI OS.</p>
          </div>
          <div role="radiogroup" aria-label="Tabs" className="grid gap-3 sm:grid-cols-2">
            {TAB_MODES.map((m) => {
              const active = m.tabs === showTabs;
              return (
                <button
                  key={m.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    if (active) return;
                    writeTabStripCookie(m.tabs ? "1" : "0");
                    setShowTabs(m.tabs);
                    reloadSettings();
                  }}
                  className={cn(
                    "flex flex-col gap-3 rounded-os-item border-2 bg-os-well p-3 text-left transition-colors",
                    active ? "border-os-accent" : "border-transparent hover:border-os-container-hi",
                  )}
                >
                  <TabsPreview tabs={m.tabs} />
                  <span className="text-sm text-foreground">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {inBrowser && (
        <div className="flex items-center gap-5 px-6 py-4">
          <TabsPreview tabs className="hidden w-40 shrink-0 sm:flex" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] text-foreground">Tabs</p>
            <p className="mt-0.5 text-sm text-os-grey">Tabs are in the desktop app.</p>
          </div>
          <a href="/download" className={cn(buttonClasses("secondary", "sm"), "shrink-0")}>
            Download
          </a>
        </div>
      )}
      {inBrowser && (
        <SettingRow
          label="Open links in the desktop app"
          help="Links you open in this browser go to the app. Saved on this browser."
          control={
            <Toggle
              tone="os"
              aria-label="Open links in the desktop app"
              checked={openInApp}
              onChange={(e) => {
                writeOpenInAppCookie(e.target.checked);
                setOpenInApp(e.target.checked);
              }}
            />
          }
        />
      )}
      <SettingRow
        label="Emoji suggestions"
        help="Type : in a doc to pick an emoji. Saved on this device."
        control={
          <Toggle
            tone="os"
            aria-label="Emoji suggestions"
            checked={emoji}
            onChange={(e) => {
              setEmoji(e.target.checked);
              setEmojiSuggestionsPreference(e.target.checked);
              toast.success(`Emoji suggestions ${e.target.checked ? "on" : "off"}`);
            }}
          />
        }
      />
    </div>
  );
}

export function PresenceSettingsBlock({ hideActivity }: { hideActivity: boolean }) {
  const fetcher = useFetcher();
  // Optimistic while the save is in flight.
  const appearAway = fetcher.formData
    ? fetcher.formData.get("hideActivity") === "true"
    : hideActivity;

  return (
    <div className="rounded-os-card bg-os-card">
      <SettingRow
        label="Appear away"
        help="Hide your online dot from other members. You still get notifications."
        control={
          <Toggle
            tone="os"
            aria-label="Appear away"
            checked={appearAway}
            onChange={(e) =>
              fetcher.submit(
                { hideActivity: String(e.target.checked) },
                { method: "post", action: "/api/presence/hide-activity" },
              )
            }
          />
        }
      />
    </div>
  );
}
