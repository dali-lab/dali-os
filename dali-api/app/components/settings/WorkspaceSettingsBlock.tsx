import { useEffect, useState } from "react";
import { PanelTop, Square } from "lucide-react";
import { cn } from "~/lib/cn";
import { readTablessPreference, setTablessPreference } from "~/lib/tabless";

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

export function WorkspaceSettingsBlock() {
  // Matches AppearanceSettingsBlock: render the default on the server, then
  // correct to the cookie-backed value on mount to avoid a hydration mismatch.
  const [tabless, setTabless] = useState(false);

  useEffect(() => {
    setTabless(readTablessPreference());
  }, []);

  // Switching modes changes the shell's server-rendered structure, so the top
  // window must do a full load. In tab mode this block renders inside a
  // workspace iframe, so reload the parent, not the frame.
  function choose(next: boolean) {
    if (next === tabless) return;
    setTablessPreference(next);
    setTabless(next);
    let top: Window = window;
    try {
      top = window.top ?? window;
    } catch {
      // Cross-origin ancestor — fall back to this window.
    }
    top.location.replace("/settings");
  }

  return (
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
              onClick={() => choose(value === "tabless")}
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
