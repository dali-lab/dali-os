import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Briefcase, Plus, X } from "lucide-react";

// Manage the non-DALI jobs a member logs hours against. Lives on the Timesheet
// tab because that's the only place these are used: they exist so hours from an
// outside job get a role to attribute to, and so the JobX extension sees them
// as their own hire to fill.
//
// A real button in the section header opening a dropdown, not an inline text
// toggle wedged above the form — this is a setting you visit occasionally, so
// it belongs with the section's other chrome rather than in the path of the
// thing you came to do.

type Hire = { id: string; label: string };

async function post(body: Record<string, string>): Promise<any> {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  const res = await fetch("/api/custom-hires", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  return res.json().catch(() => ({}));
}

export function CustomHiresManager({ hires }: { hires: Hire[] }) {
  const revalidator = useRevalidator();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    const res = await post(body);
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    // The role picker is fed by the loader, so a new job only reaches it on
    // revalidation.
    revalidator.revalidate();
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          open
            ? "border-accent-coral/40 bg-accent-coral/10 text-accent-coral"
            : "border-border text-foreground hover:bg-muted"
        }`}
      >
        <Briefcase className="h-3.5 w-3.5" />
        Add jobs
        {hires.length > 0 && (
          <span className="text-muted-foreground tabular-nums">{hires.length}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Add jobs"
          className="absolute right-0 z-30 mt-1 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-brand-2"
        >
          <p className="text-xs text-muted-foreground">
            Jobs you hold outside DALI. Add one and it becomes a role you can log hours against,
            and its own timesheet in the JobX extension.
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {hires.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {hires.map((h) => (
                <li
                  key={h.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
                >
                  {h.label}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${h.label}`}
                    onClick={() => void run({ intent: "archive", id: h.id })}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = label.trim();
              if (!next) return;
              setLabel("");
              void run({ intent: "create", label: next });
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder="e.g. Baker Library front desk"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
            <button
              type="submit"
              disabled={busy || !label.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-coral px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-coral/90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </form>

          <p className="text-[11px] text-muted-foreground">
            Removing a job keeps hours you already logged against it — it just stops appearing in
            the role picker.
          </p>
        </div>
      )}
    </div>
  );
}
