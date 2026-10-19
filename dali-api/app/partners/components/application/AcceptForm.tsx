// Inline confirmation shown under the modal's "Accept" button (Interview
// stage). The CRM intent itself takes no extra fields — it just moves the
// stage and emails the acceptance — so this is a confirm step, not a form.

import { useState } from "react";
import { Button } from "~/components/ui/Button";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

export function AcceptForm({
  applicationId,
  onDone,
  onCancel,
}: {
  applicationId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    const res = await postPartnerApplicationIntent(applicationId, "accept");
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't accept this application.");
      return;
    }
    onDone();
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        This marks the application Accepted and emails the partner.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={() => void confirm()} disabled={saving}>
          {saving ? "Accepting…" : "Confirm accept"}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
