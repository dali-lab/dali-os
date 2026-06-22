// Per-slot guardrail strip for the Core staffing boards. Binding a form,
// mapping its columns, and announcing it to members are three independent
// steps; this makes all three visible so a slot that's bound-but-unsent
// (nobody can apply) doesn't look the same as "sent, nobody responded".
import type { SlotStatus } from "../lib/slot-status.server";

export function SlotStatusStrip({ status }: { status: SlotStatus }) {
  const yn = (b: boolean) => (b ? "yes" : "no");
  // Bound, mapping aside, but never announced → nobody can apply. Surface it
  // with the same amber treatment as the mapping warning.
  const unsent = status.bound && status.sentToCount === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Form bound:{" "}
          <span className="font-medium text-foreground">{yn(status.bound)}</span>
        </span>
        <span>
          Column mapping complete:{" "}
          <span className="font-medium text-foreground">
            {yn(status.mappingComplete)}
          </span>
        </span>
        <span>
          Sent to{" "}
          <span className="font-medium text-foreground">
            {status.sentToCount}
          </span>{" "}
          {status.sentToCount === 1 ? "member" : "members"}
        </span>
      </div>

      {unsent && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-medium">Bound but not yet sent:</span> a form is
          connected but no announcement has gone out, so members can't apply
          yet. Use <em>Send to members</em> in Advanced settings to notify them.
        </div>
      )}
    </div>
  );
}
