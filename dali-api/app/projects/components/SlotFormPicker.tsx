// Per-term form picker shown on the Intent to Work / Project Bids boards.
// Lets a staffing manager choose which generic form members fill for the
// current cycle's slot. Viewers (Core/Admin without staffing management) see
// the current selection read-only. The board's submission table is unaffected
// — this only controls which form is surfaced to members.
import { useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";

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

  // Slot-bound forms are filled through the AUTHENTICATED member route so the
  // submission is attributed to the member (and, for Project Bids, can be
  // interpreted into their StaffingPreference). The token is still the form's
  // publicToken — it's only the addressing key; that route requires a session.
  const fillUrl =
    binding?.published && binding.publicToken
      ? `/forms/fill/${binding.publicToken}`
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
            <Select
              name="formId"
              value={selected}
              onChange={(v) => setSelected(v)}
              ariaLabel={`${slotLabel} form`}
              options={[
                { value: "", label: "— No form selected —" },
                ...forms.map((f) => ({
                  value: f.id,
                  label: f.name + (f.published ? "" : " (unpublished)"),
                })),
              ]}
              buttonClassName="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={saving || !dirty}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </fetcher.Form>
        ) : (
          <div className="flex-1 text-sm text-foreground">
            {binding ? binding.formName : "No form selected"}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Binding a form and telling members about it are two separate steps —
          setSlotBinding sends nothing. Surface the send action right here so a
          form can't be bound but silently never announced. Deep-links to the
          existing Announcements composer (pre-seeded with this form + the whole
          lab); no new send path, so the composer's published-form check still
          applies. Disabled until the form is published, since the composer
          rejects unpublished forms. */}
      {canManage && binding && (
        <div className="flex flex-wrap items-center gap-2">
          {fillUrl ? (
            <a
              href={`/admin/announcements?formId=${encodeURIComponent(binding.formId)}&audience=all`}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted"
            >
              Send to members
            </a>
          ) : (
            <span
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground opacity-60 cursor-not-allowed"
              title="Publish the form before sending it to members"
            >
              Send to members
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Opens the Announcements composer with this form attached.
          </span>
        </div>
      )}

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
