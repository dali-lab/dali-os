import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "~/lib/cn";
import {
  applyTheme,
  readThemePreference,
  setThemePreference,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "~/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

export function AppearanceSettingsBlock() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    setPreference(readThemePreference());
    applyTheme();

    function onStorage(e: StorageEvent) {
      if (e.key !== THEME_STORAGE_KEY) return;
      setPreference(readThemePreference());
      applyTheme();
    }
    function onThemeChange() {
      setPreference(readThemePreference());
      applyTheme();
    }
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== THEME_CHANGE_EVENT) return;
      setPreference(readThemePreference());
      applyTheme();
    }
    function onMedia() {
      if (readThemePreference() === "system") applyTheme();
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener("message", onMessage);
    mq.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener("message", onMessage);
      mq.removeEventListener("change", onMedia);
    };
  }, []);

  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              setPreference(value);
              setThemePreference(value);
            }}
            className={cn(
              "flex flex-col gap-3 rounded-os-item border-2 bg-os-card p-3 text-left transition-colors",
              selected ? "border-os-accent" : "border-transparent hover:border-os-container-hi",
            )}
          >
            <ThemePreview theme={value} />
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Icon className={cn("h-4 w-4", selected ? "text-os-accent" : "text-os-grey")} aria-hidden />
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Fixed swatches, not theme tokens: each card shows its own theme whatever the
// current one is.
function ThemePreview({ theme }: { theme: ThemePreference }) {
  const half = (dark: boolean) => (
    <div className={cn("flex h-full flex-1 gap-1.5 p-2", dark ? "bg-[#282830]" : "bg-[#f4f8fa]")}>
      <div className={cn("w-1/4 rounded", dark ? "bg-[#24242a]" : "bg-[#dfe7ec]")} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className={cn("h-2 w-2/3 rounded-full", dark ? "bg-[#54545f]" : "bg-[#c6cacc]")} />
        <div className={cn("flex-1 rounded", dark ? "bg-[#2b2b36]" : "bg-white")} />
      </div>
    </div>
  );
  return (
    <div className="flex h-20 overflow-hidden rounded-lg border border-os-container" aria-hidden>
      {theme !== "dark" && half(false)}
      {theme !== "light" && half(true)}
    </div>
  );
}
