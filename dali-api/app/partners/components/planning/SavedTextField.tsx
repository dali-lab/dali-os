import { useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import type { PlanningNoteView } from "../../lib/planning-notes.server";

export const PLANNING_ACTION = "/core/partners/planning";

export function fetcherError(data: unknown): string | null {
  return data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : null;
}

export function noteMeta(note: PlanningNoteView | null): string | null {
  if (!note) return null;
  const when = new Date(note.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return note.updatedByName ? `Last edited by ${note.updatedByName} on ${when}` : `Last edited on ${when}`;
}

export function SavedTextField({
  title,
  label,
  placeholder,
  value,
  fields,
  bodyField,
  saveLabel,
  hint,
  meta,
  canEdit,
}: {
  title: string;
  label: string;
  placeholder: string;
  value: string | null;
  fields: Record<string, string>;
  bodyField: string;
  saveLabel: string;
  hint?: ReactNode;
  meta?: string | null;
  canEdit: boolean;
}) {
  const { formClass } = useOsChrome();
  const fetcher = useFetcher();
  const [draft, setDraft] = useState(value ?? "");
  const busy = fetcher.state !== "idle";
  const error = fetcherError(fetcher.data);
  const dirty = draft.trim() !== (value ?? "").trim();

  if (!canEdit) {
    return value ? (
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <p className="whitespace-pre-line text-sm text-foreground">{value}</p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </section>
    ) : null;
  }

  const save = () => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set(bodyField, draft);
    fetcher.submit(form, { method: "post", action: PLANNING_ACTION });
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className={formClass}>
        <textarea
          aria-label={label}
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-full resize-y"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        {error ? (
          <p className="mr-auto text-xs text-destructive">{error}</p>
        ) : (
          meta && <p className="mr-auto text-xs text-muted-foreground">{meta}</p>
        )}
        {dirty && (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(value ?? "")}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={save}>
              {busy ? "Saving" : saveLabel}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
