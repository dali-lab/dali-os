import { useState } from "react";
import { Modal } from "~/components/Modal";
import { APPLICATION_TZ, APPLICATION_TZ_LABEL } from "~/lib/timezone";

// Confirms Draft to Open on a cycle: opening applications is irreversible in
// practice (applicants start drafting), so the lead sees the close date first.

export function OpenApplicationsConfirmModal({
  cycleId,
  closeDate,
  onClose,
  onOpened,
  onError,
}: {
  cycleId: string;
  closeDate: Date | null;
  onClose: () => void;
  onOpened: () => void;
  onError: (msg: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const headingId = `open-confirm-heading-${cycleId}`;

  async function confirmOpen() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: 'Open' }),
      });
      if (res.ok) {
        onOpened();
        return;
      }
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? `Couldn't open applications (HTTP ${res.status}).`);
    } catch (e: any) {
      onError(e?.message ?? 'Network error opening applications.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => {} : onClose}
      disableEscape={submitting}
      labelledBy={headingId}
      containerClassName="bg-card rounded-2xl shadow-xl max-w-md w-full mx-4 p-6"
    >
      <div className="space-y-4">
        <h2 id={headingId} className="text-lg font-bold text-foreground">
          Open applications for this cycle?
        </h2>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            <span className="font-semibold text-foreground">This is irreversible for the cycle.</span>{' '}
            Once applications open, you can't return the cycle to Draft.
          </p>
          <p>
            The general challenge and per-domain challenges will no longer be editable while the cycle is open.
          </p>
          {closeDate && (
            <div className="bg-muted/40 rounded-lg p-3 text-xs">
              <span className="font-medium text-foreground/80">Applications close: </span>
              <span>
                {closeDate.toLocaleString("en-US", {
                  timeZone: APPLICATION_TZ,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                {APPLICATION_TZ_LABEL}
              </span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmOpen}
            disabled={submitting}
            className="px-3 py-2 text-sm font-medium text-white bg-accent-coral hover:bg-accent-coral/90 rounded-md disabled:opacity-50"
          >
            {submitting ? 'Opening...' : 'Open applications'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
