import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Pencil, Plus } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { HIRING_NOTE_MAX } from "~/hiring/lib/hiring-note";
import { cn } from "~/lib/cn";

export function HiringNote({ note, canEdit }: { note: string | null; canEdit: boolean }) {
  const { panel, panelPad, bodyText } = useOsChrome();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setEditing(false);
  }, [fetcher.state, fetcher.data]);

  if (!note && !canEdit) return null;

  if (editing) {
    return (
      <fetcher.Form method="post" className={cn(panel, panelPad, "os-form flex flex-col gap-3")}>
        <input type="hidden" name="intent" value="save-hiring-note" />
        <textarea
          name="note"
          aria-label="Note"
          value={draft}
          maxLength={HIRING_NOTE_MAX}
          rows={3}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add context for anyone reading this application"
        />
        {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(note ?? "");
              setEditing(false);
            }}
            className={buttonClasses("ghost", "sm")}
          >
            Cancel
          </button>
          <button type="submit" disabled={saving} className={buttonClasses("primary", "sm")}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </fetcher.Form>
    );
  }

  if (!note) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(bodyText, "inline-flex items-center gap-1.5 hover:text-foreground")}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add note
      </button>
    );
  }

  return (
    <section aria-label="Note" className={cn(panel, panelPad, "flex items-start gap-3")}>
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-foreground">{note}</p>
      {canEdit && (
        <IconButton
          label="Edit note"
          icon={Pencil}
          onClick={() => {
            setDraft(note);
            setEditing(true);
          }}
        />
      )}
    </section>
  );
}
