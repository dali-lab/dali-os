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

const OPTIONS: {
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}[] = [
  {
    value: "light",
    label: "Light",
    description: "Always use light mode",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use dark mode",
    icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Match your device setting",
    icon: Monitor,
  },
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
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Choose how DALI OS looks. Saved on this device.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map(({ value, label, description, icon: Icon }) => {
          const selected = preference === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                setPreference(value);
                setThemePreference(value);
              }}
              aria-pressed={selected}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border px-3 py-3 text-left transition-colors",
                selected
                  ? "border-accent-coral bg-accent-coral/10 ring-1 ring-accent-coral/40"
                  : "border-border bg-card hover:bg-muted/50",
              )}
            >
              <span className="inline-flex items-center gap-2 font-heading text-sm font-semibold text-foreground">
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
