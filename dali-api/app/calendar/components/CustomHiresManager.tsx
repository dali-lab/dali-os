import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Plus, X } from "lucide-react";
import { AnchoredPopover } from "~/calendar/components/AnchoredPopover";
import { cn } from "~/lib/cn";

// Manage the non-DALI jobs a member logs hours against. Lives next to the
// timesheet role list because that's the only place these are used: they exist
// so hours from an outside job get a role to attribute to, and so the JobX
// extension sees them as their own hire to fill.
//
// Quieter than the timesheet mode pill — a text control under the role list,
// not a second capsule of the same weight. The form itself is a portaled
// popover so the sidebar's overflow can't clip it.

type Hire = { id: string; label: string };

async function post(body: Record<string, string>): Promise<{ error?: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  try {
    const res = await fetch("/api/custom-hires", {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { error: data.error || `Couldn't save (${res.status})` };
    return data;
  } catch {
    return { error: "Couldn't reach the server" };
  }
}

/** Archive a custom hire from outside this component (the sidebar's per-role
 *  delete). Same endpoint the manager's own remove button uses. */
export async function archiveCustomHire(id: string): Promise<{ error?: string }> {
  return post({ intent: "archive", id });
}

export function CustomHiresManager({ hires }: { hires: Hire[] }) {
  const revalidator = useRevalidator();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setAnchor(null);
  }

  async function run(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await post(body);
      if (res?.error) {
        setError(res.error);
        return;
      }
      // The role picker is fed by the loader, so a new job only reaches it on
      // revalidation.
      revalidator.revalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setAnchor(btnRef.current?.getBoundingClientRect() ?? null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors",
          open
            ? "text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Add role
      </button>

      {open && (
        <AnchoredPopover
          anchor={anchor}
          excludeRef={btnRef}
          onClose={close}
          ariaLabel="Add role"
          className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl cal-surface p-3"
        >
          <p className="text-xs text-muted-foreground">Jobs outside DALI you log hours against.</p>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {hires.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {hires.map((h) => (
                <li
                  key={h.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground"
                >
                  {h.label}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${h.label}`}
                    onPointerDown={(e) => {
                      // Pointer-down (not click): a document capture listener
                      // on the popover would otherwise unmount this node
                      // before click fires, so the archive never ran.
                      e.preventDefault();
                      e.stopPropagation();
                      if (busy) return;
                      void run({ intent: "archive", id: h.id });
                    }}
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
              className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
            <button
              type="submit"
              disabled={busy || !label.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-os-accent px-4 py-1.5 text-sm font-semibold text-os-bg hover:bg-os-accent-hover disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </form>
        </AnchoredPopover>
      )}
    </>
  );
}
