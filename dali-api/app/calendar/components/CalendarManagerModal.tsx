import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { pendingForm } from "~/calendar/lib/fetcher-pending";
import { X, Pencil, Trash2 } from "lucide-react";
import { Select, Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import type { LoaderData, SubCalendarDTO } from "~/calendar/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────


export const managerFieldCls = "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

export function ManagedCalendarRow({ linkId, cal }: { linkId: string; cal: SubCalendarDTO }) {
  const renameFetcher = useFetcher<{ error?: string } | null>();
  const deleteFetcher = useFetcher<{ error?: string } | null>();
  const dialog = useDialog();
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  useEffect(() => {
    if (renameFetcher.data?.error) setRenaming(true);
  }, [renameFetcher.data]);

  const error = renameFetcher.data?.error ?? deleteFetcher.data?.error;
  if (pendingForm(deleteFetcher)) return null;
  const summary = (pendingForm(renameFetcher)?.get("summary") as string | undefined) ?? cal.summary;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5">
        <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: cal.color ?? "#9ca3af" }} />
        {renaming ? (
          <renameFetcher.Form method="post" onSubmit={() => setRenaming(false)} className="flex flex-1 items-center gap-1">
            <input type="hidden" name="intent" value="cal-rename" />
            <input type="hidden" name="linkId" value={linkId} />
            <input type="hidden" name="calendarId" value={cal.id} />
            <input name="summary" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} className={cn(managerFieldCls, "flex-1")} autoFocus />
            <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">Save</button>
          </renameFetcher.Form>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {summary}
            {cal.primary && <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">Primary</span>}
            {!cal.writable && <span className="ml-1.5 text-[10px] text-muted-foreground">read-only</span>}
          </span>
        )}
        {cal.writable && !renaming && (
          <>
            <button
              type="button"
              onClick={() => {
                setRenaming(true);
                setRenameVal(cal.summary);
              }}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Rename ${cal.summary}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!cal.primary && (
              <Tooltip content={`Delete ${cal.summary}`}>
                <button
                  type="button"
                  aria-label={`Delete ${cal.summary}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                  onClick={async () => {
                    const ok = await dialog.confirm({
                      title: `Delete "${cal.summary}"?`,
                      description: "Deletes this calendar and every event on it from Google.",
                      tone: "destructive",
                      confirmLabel: "Delete calendar",
                    });
                    if (ok)
                      deleteFetcher.submit(
                        { intent: "cal-delete", linkId, calendarId: cal.id },
                        { method: "post" },
                      );
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function CalendarManagerModal({ data, onClose }: { data: LoaderData; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string } | null>();
  const [newName, setNewName] = useState("");
  const googleLinks = data.calendarLinks.filter((l) => l.provider === "Google" && l.subCalendars);
  const [newLink, setNewLink] = useState(googleLinks[0]?.id ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const prev = useRef(fetcher.state);
  useEffect(() => {
    if (prev.current !== "idle" && fetcher.state === "idle" && !fetcher.data?.error) {
      setNewName("");
    }
    prev.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  const fieldCls = managerFieldCls;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 backdrop-blur-sm p-4 py-10">
      <button type="button" className="fixed inset-0 cursor-default" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div role="dialog" aria-modal="true" aria-label="Manage calendars" className="relative z-10 w-full max-w-md rounded-xl cal-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">Manage calendars</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {googleLinks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connect a Google account first.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {googleLinks.map((link) => (
              <div key={link.id} className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {link.displayName || link.externalEmail}
                </div>
                {(link.subCalendars ?? []).map((cal) => (
                  <ManagedCalendarRow key={cal.id} linkId={link.id} cal={cal} />
                ))}
              </div>
            ))}

            <fetcher.Form method="post" className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <input type="hidden" name="intent" value="cal-create" />
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New calendar</div>
              <input name="summary" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Calendar name" className={fieldCls} />
              {googleLinks.length > 1 && (
                <Select
                  value={newLink}
                  onChange={setNewLink}
                  options={googleLinks.map((l) => ({ value: l.id, label: l.displayName || l.externalEmail }))}
                  buttonClassName={cn(fieldCls, "w-full inline-flex items-center justify-between gap-1 text-left hover:bg-muted/40")}
                />
              )}
              <input type="hidden" name="linkId" value={newLink} />
              {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
              <button
                type="submit"
                disabled={newName.trim() === "" || newLink === "" || fetcher.state !== "idle"}
                className="os-btn-primary w-fit disabled:opacity-50"
              >
                Create calendar
              </button>
            </fetcher.Form>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ClassesManagerModal ────────────────────────────────────────────────────
// "My classes this term" — add Dartmouth classes (period picker or custom time)
// to the calendar, synced to a linked Google calendar or kept as a DALI layer.
