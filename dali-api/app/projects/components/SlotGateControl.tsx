// Optional app-lock control for a staffing slot, shown in the slot's Advanced
// settings below the form picker. Lets a staffing manager require the bound
// form: members in the chosen audience are hard-gated into filling it before
// they can use the app (see app/forms/lib/gate.server.ts). Hidden entirely
// unless the `bound-form-lock` flag is on. Viewers (canManage false) see the
// current setting read-only.
import { useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { useFeatureFlag } from "~/components/FeatureFlags";

// Value "" = not locked. The rest are the GATE_AUDIENCES (form-slots.ts), a
// subset of the signing SigningAudience enum the gate resolvers understand.
const GATE_OPTIONS = [
  { value: "", label: "Don't lock the app" },
  { value: "Group", label: "Everyone active this term" },
  { value: "Members", label: "Returning members (staffed this term)" },
  { value: "NewMembers", label: "New members (first term staffed)" },
  { value: "Mentors", label: "Mentors (staffed this term)" },
];

function labelFor(value: string | null): string {
  return GATE_OPTIONS.find((o) => o.value === (value ?? ""))?.label ?? "Locked";
}

export function SlotGateControl({
  slotLabel,
  gateAudience,
  canManage,
}: {
  slotLabel: string;
  gateAudience: string | null;
  canManage: boolean;
}) {
  const enabled = useFeatureFlag("bound-form-lock");
  const fetcher = useFetcher();
  const [selected, setSelected] = useState(gateAudience ?? "");
  if (!enabled) return null;

  const saving = fetcher.state !== "idle";
  const error =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;
  const dirty = selected !== (gateAudience ?? "");

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="text-sm text-muted-foreground sm:w-44 shrink-0">
          Lock the app
        </div>

        {canManage ? (
          <fetcher.Form
            method="post"
            className="flex flex-1 flex-col sm:flex-row gap-2"
          >
            <input type="hidden" name="intent" value="set-slot-gate" />
            <Select
              name="gateAudience"
              value={selected}
              onChange={(v) => setSelected(v)}
              ariaLabel={`${slotLabel} app-lock audience`}
              options={GATE_OPTIONS}
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
            {labelFor(gateAudience)}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground">
        When locked, members in the chosen audience are sent to fill this form
        before they can use the rest of the app — like an unsigned agreement.
        Filling it once clears the lock; it can't be re-filled. Full-time staff
        and members outside the audience are never gated.
      </p>
    </div>
  );
}
