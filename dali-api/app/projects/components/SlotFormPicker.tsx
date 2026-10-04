// Per-term form picker shown on the Intent to Work / Project Bids boards.
// Lets a staffing manager choose which generic form members fill for the
// current cycle's slot. Viewers (Core/Admin without staffing management) see
// the current selection read-only. The board's submission table is unaffected
// — this only controls which form is surfaced to members.
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { Select, Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";

type SelectableForm = {
  id: string;
  name: string;
  published: boolean;
  // Set when another cycle holds this form for the same slot: picking it is a
  // move, not a copy, so saving asks first.
  boundToCycleName?: string;
};

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
  const { confirm } = useDialog();
  const toast = useToast();
  const [selected, setSelected] = useState(binding?.formId ?? "");

  const saving = fetcher.state !== "idle";
  const error =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;
  const dirty = selected !== (binding?.formId ?? "");
  const held = forms.find((f) => f.id === selected)?.boundToCycleName ?? null;

  // A form only collects for one cycle at a time, so saving one that another
  // cycle holds takes it off that cycle. Confirm first, then send the
  // acknowledgement the action requires (it refuses the move without it, so a
  // picker rendered before someone else re-bound the form fails loudly instead
  // of quietly stopping their round).
  async function save() {
    if (held) {
      const ok = await confirm({
        title: `Move this form off ${held}?`,
        description: `"${forms.find((f) => f.id === selected)?.name}" is collecting for ${held}. Moving it here stops that, and brings its column mapping and app lock along. Submissions already recorded for ${held} stay with ${held}.`,
        confirmLabel: "Move it here",
        tone: "destructive",
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set("intent", "set-slot-form");
    fd.set("formId", selected);
    if (held) fd.set("allowMove", "1");
    fetcher.submit(fd, { method: "post" });
  }

  // Say where it came from, since the other cycle's board just changed too.
  const movedFrom =
    fetcher.data && typeof fetcher.data === "object" && "movedFrom" in fetcher.data
      ? ((fetcher.data as { movedFrom: unknown }).movedFrom as string | null)
      : null;
  useEffect(() => {
    if (movedFrom) toast(`Moved off ${movedFrom}.`);
  }, [movedFrom, toast]);

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
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Select
              name="formId"
              value={selected}
              onChange={(v) => setSelected(v)}
              ariaLabel={`${slotLabel} form`}
              options={[
                { value: "", label: "— No form selected —" },
                ...forms.map((f) => ({
                  value: f.id,
                  label:
                    f.name +
                    (f.published ? "" : " (unpublished)") +
                    (f.boundToCycleName ? ` · on ${f.boundToCycleName}` : ""),
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
            <Tooltip
              variant="rich"
              content="Publish this form in Drive before sending — unpublished forms can't be filled by members."
            >
              <span
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground opacity-60 cursor-not-allowed"
              >
                Send to members
              </span>
            </Tooltip>
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
              {/* Not target="_blank": the desktop shell has no second window
                  to open into, so the click did nothing. */}
              <a
                href={fillUrl}
                onClick={(e) => {
                  if (requestOpenTabIfEmbedded(fillUrl, binding.formName))
                    e.preventDefault();
                }}
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
