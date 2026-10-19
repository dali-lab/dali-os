// Statement-of-work state and its next action, above the co-drafted SOW
// editor in the Statement of work tab. Posts intent "sow-state" {to} to the
// application detail route's action (handleSowIntent in partner-finance.server.ts).

import { useState } from "react";
import { Button } from "~/components/ui/Button";
import { Pill, type PillTone } from "~/hiring/components/cycle-setup/SetupCard";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

export type PartnerSowState = "Draft" | "Shared" | "Accepted";

const STATE_HINT: Record<PartnerSowState, string> = {
  Draft: "Share emails it to the partner to review.",
  Shared: "Waiting for the partner to accept it in their portal.",
  Accepted: "The partner accepted it.",
};

const STATE_TONE: Record<PartnerSowState, PillTone> = {
  Draft: "neutral",
  Shared: "accent",
  Accepted: "success",
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Pill dot={STATE_TONE[sowState]}>{sowState}</Pill>
          <p className="text-sm text-os-grey">{STATE_HINT[sowState]}</p>
        </div>
        {canEdit && sowState === "Draft" && (
          <Button variant="primary" size="sm" onClick={() => void move("Shared")} disabled={moving}>
            {moving ? "Sharing…" : "Share with partner"}
          </Button>
        )}
        {canEdit && sowState === "Shared" && (
          <Button variant="secondary" size="sm" onClick={() => void move("Accepted")} disabled={moving}>
            {moving ? "Saving…" : "Mark accepted"}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
