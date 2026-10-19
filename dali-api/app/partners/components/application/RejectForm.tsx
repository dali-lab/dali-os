// Inline reject form shown under the modal's destructive "Reject" link.
// Mirrors the full page's reject form, posting the same intent.

import { useState } from "react";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import {
  PARTNER_REJECT_REASONS,
  PARTNER_REJECT_REASON_LABELS,
  type PartnerRejectReason,
} from "../../lib/partner-application";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

export function RejectForm({
  applicationId,
  onDone,
  onCancel,
}: {
  applicationId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [rejectReason, setRejectReason] = useState<PartnerRejectReason | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!rejectReason) {
      setError("Choose a rejection reason.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await postPartnerApplicationIntent(applicationId, "reject", {
      rejectReason,
      reason: reason.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't reject this application.");
      return;
    }
    onDone();
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">Reason *</span>
        <Select
          value={rejectReason}
          onChange={(v) => setRejectReason(v as PartnerRejectReason)}
          ariaLabel="Rejection reason"
          placeholder="Choose a reason…"
          options={PARTNER_REJECT_REASONS.map((r) => ({
            value: r,
            label: PARTNER_REJECT_REASON_LABELS[r],
          }))}
          buttonClassName="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">Note (shown to partner, optional)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Brief, partner-facing explanation…"
          className="resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" onClick={() => void submit()} disabled={saving}>
          {saving ? "Rejecting…" : "Reject"}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
