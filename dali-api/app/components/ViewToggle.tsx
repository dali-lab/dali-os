import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "~/lib/cn";
import { readStorage, writeStorage } from "~/lib/safe-storage";

export type ListView = "list" | "card";

/** Persisted list-vs-card preference, scoped by `storageKey`. */
export function useViewPreference(storageKey: string, fallback: ListView = "list"): [
  ListView,
  (next: ListView) => void,
] {
  const [view, setView] = useState<ListView>(fallback);
  // Hydrate from localStorage on the client only — guards against SSR mismatch.
  useEffect(() => {
    const stored = readStorage(storageKey);
    if (stored === "list" || stored === "card") setView(stored);
  }, [storageKey]);

  const set = (next: ListView) => {
    setView(next);
    writeStorage(storageKey, next);
  };

  return [view, set];
}

export function ViewToggle({
  value,
  onChange,
}: {
  value: ListView;
  onChange: (next: ListView) => void;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center border border-border overflow-hidden",
        "rounded-full bg-card",
      )}
    >
      <ToggleButton
        active={value === "list"}
        onClick={() => onChange("list")}
        label="List view"
      >
        <List className="w-3.5 h-3.5" />
      </ToggleButton>
      <ToggleButton
        active={value === "card"}
        onClick={() => onChange("card")}
        label="Card view"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "transition-colors",
        "px-3.5 py-2.5",
        active
          ? "bg-os-container text-foreground"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
