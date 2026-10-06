// Statement-of-work state control for one application. Mounted on the Core
// application detail page alongside the co-drafted SOW editor. Posts intent
// "sow-state" {to} to that route's action, which must call handleSowIntent
// (app/partners/lib/partner-finance.server.ts).

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

export type PartnerSowState = "Draft" | "Shared" | "Accepted";

const STATE_PILL: Record<PartnerSowState, string> = {
  Draft: "bg-muted text-muted-foreground",
  Shared: "bg-accent-coral/15 text-accent-coral",
  Accepted: "bg-accent-teal/15 text-accent-teal",
};

export function SowStatePanel({
  applicationId,
  sowState,
  canEdit,
  onChanged,
}: {
  applicationId: string;
  sowState: PartnerSowState;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(to: PartnerSowState) {
    setMoving(true);
    setError(null);
    const res = await postPartnerApplicationIntent(applicationId, "sow-state", { to });
    setMoving(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't update the statement of work.");
      return;
    }
    onChanged();
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Statement of work
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_PILL[sowState]}`}>
          {sowState}
        </span>
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          {sowState === "Draft" && (
            <Button variant="primary" size="sm" onClick={() => void move("Shared")} disabled={moving}>
              {moving ? "Sharing…" : "Share with partner"}
            </Button>
          )}
          {sowState === "Accepted" && (
            <Button variant="secondary" size="sm" onClick={() => void move("Draft")} disabled={moving}>
              {moving ? "Reverting…" : "Revert to draft"}
            </Button>
          )}
          {sowState === "Shared" && (
            <p className="text-sm text-muted-foreground">Waiting on the partner to accept.</p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
