import { useEffect, useState } from "react";
import { PanelTop, Square } from "lucide-react";
import { cn } from "~/lib/cn";
import { readTablessPreference, setTablessPreference } from "~/lib/tabless";
import { readFocusPreference, setFocusPreference } from "~/lib/focus-mode";

const OPTIONS: {
  value: "tabs" | "tabless";
  label: string;
  description: string;
  icon: typeof PanelTop;
}[] = [
  {
    value: "tabs",
    label: "Tabbed workspace",
    description: "Open sections as tabs, with split view and pinning",
    icon: PanelTop,
  },
  {
    value: "tabless",
    label: "Single page",
    description: "One page at a time, using your browser's own tabs and history",
    icon: Square,
  },
];

// Both prefs are cookie-backed and change the server-rendered shell, so applying
// one reloads the top window. In tab mode this block renders inside a workspace
// iframe, so reload the parent, not the frame.
function reloadSettings() {
  let top: Window = window;
  try {
    top = window.top ?? window;
  } catch {
    // Cross-origin ancestor — fall back to this window.
  }
  top.location.replace("/settings");
}

export function WorkspaceSettingsBlock() {
  // Matches AppearanceSettingsBlock: render defaults on the server, then correct
  // to the cookie-backed values on mount to avoid a hydration mismatch.
  const [tabless, setTabless] = useState(false);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    setTabless(readTablessPreference());
    setFocus(readFocusPreference());
  }, []);

  function chooseTabless(next: boolean) {
    if (next === tabless) return;
    setTablessPreference(next);
    setTabless(next);
    reloadSettings();
  }

  function toggleFocus() {
    const next = !focus;
    setFocusPreference(next);
    setFocus(next);
    reloadSettings();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Choose how pages open. Saved on this device.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map(({ value, label, description, icon: Icon }) => {
            const selected = (value === "tabless") === tabless;
            return (
              <button
                key={value}
                type="button"
                onClick={() => chooseTabless(value === "tabless")}
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

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <p className="font-heading text-sm font-semibold text-foreground">Focus mode</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Hide the sidebar and navigate with ⌘K and breadcrumbs. A floating
            button brings it back anytime.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={focus}
          aria-label="Focus mode"
          onClick={toggleFocus}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
            focus ? "bg-accent-coral" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              focus ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}
