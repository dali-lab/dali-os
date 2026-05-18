// Per-term form picker shown on the Intent to Work / Project Bids boards.
// Lets a staffing manager choose which generic form members fill for the
// current cycle's slot. Viewers (Core/Admin without staffing management) see
// the current selection read-only. The board's submission table is unaffected
// — this only controls which form is surfaced to members.
import { useState } from "react";
import { useFetcher } from "react-router";

type SelectableForm = { id: string; name: string; published: boolean };

type Binding = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
} | null;

export function SlotFormPicker({
  slotLabel,
  binding,
  forms,
  canManage,
}: {
  slotLabel: string;
  binding: Binding;
  forms: SelectableForm[];
  canManage: boolean;
}) {
  const fetcher = useFetcher();
  const [selected, setSelected] = useState(binding?.formId ?? "");

  const saving = fetcher.state !== "idle";
  const error =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;
  const dirty = selected !== (binding?.formId ?? "");

  const fillUrl =
    binding?.published && binding.publicToken
      ? `/f/${binding.publicToken}`
      : null;

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="text-sm text-muted-foreground sm:w-44 shrink-0">
          {slotLabel} form
        </div>

        {canManage ? (
          <fetcher.Form
            method="post"
            className="flex flex-1 flex-col sm:flex-row gap-2"
          >
            <input type="hidden" name="intent" value="set-slot-form" />
            <select
              name="formId"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              aria-label={`${slotLabel} form`}
              className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            >
              <option value="">— No form selected —</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.published ? "" : " (unpublished)"}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={saving || !dirty}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </fetcher.Form>
        ) : (
          <div className="flex-1 text-sm text-foreground">
            {binding ? binding.formName : "No form selected"}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {binding && (
        <p className="text-xs text-muted-foreground">
          {fillUrl ? (
            <>
              Members fill this at{" "}
              <a
                href={fillUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent-coral hover:underline"
              >
                {fillUrl}
              </a>
            </>
          ) : (
            <>
              “{binding.formName}” is selected but not published yet — publish
              it in Forms so members can fill it.
            </>
          )}
        </p>
      )}
    </div>
  );
}
