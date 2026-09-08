import { useEffect, useId, useRef } from "react";
import { useFetcher } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { LiveCheckInCount } from "./LiveCheckInCount";

type QrData = {
  checkInQrSvg: string | null;
  checkInUrl: string | null;
  presentCount: number;
  totalCount: number;
} | null;

/**
 * Opens check-in for a session, shows the QR code + live count, and closes
 * check-in when dismissed.
 */
export function ShowQrModal({
  open,
  onClose,
  sessionId,
  approvedCount,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  approvedCount: number;
}) {
  const titleId = useId();
  const manageFetcher = useFetcher();
  const qrFetcher = useFetcher<QrData>();
  const openedRef = useRef(false);

  // On open: enable check-in + fetch QR
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;

    // Open check-in
    const fd = new FormData();
    fd.set("intent", "set-session-check-in");
    fd.set("sessionId", sessionId);
    fd.set("open", "true");
    manageFetcher.submit(fd, { method: "post" });

    // Fetch QR
    qrFetcher.load(`/api/education/sessions/${sessionId}/check-in?qr=1`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  function closeCheckIn() {
    const fd = new FormData();
    fd.set("intent", "set-session-check-in");
    fd.set("sessionId", sessionId);
    fd.set("open", "false");
    manageFetcher.submit(fd, { method: "post" });
    onClose();
  }

  const qrData = qrFetcher.data;

  return (
    <Modal
      open={open}
      onClose={closeCheckIn}
      labelledBy={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6 overflow-y-auto"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-md w-full p-6 my-auto"
    >
      <ModalHeader
        titleId={titleId}
        title="Check-in open"
        subtitle="Students can scan to mark attendance"
        onClose={closeCheckIn}
      />

      <div className="flex flex-col items-center gap-4">
        {/* QR code */}
        {qrData?.checkInQrSvg ? (
          <div
            className="w-56 h-56"
            dangerouslySetInnerHTML={{ __html: qrData.checkInQrSvg }}
          />
        ) : (
          <div className="w-56 h-56 animate-pulse rounded-xl bg-muted" />
        )}

        {/* URL */}
        {qrData?.checkInUrl && (
          <input
            readOnly
            value={qrData.checkInUrl}
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-center font-mono text-muted-foreground select-all"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}

        {/* Live count */}
        <div className="rounded-xl bg-card border border-border px-6 py-3 text-center">
          <LiveCheckInCount
            sessionId={sessionId}
            initialPresent={qrData?.presentCount ?? 0}
            initialTotal={qrData?.totalCount ?? approvedCount}
          />
        </div>

        {/* Close check-in button */}
        <button
          type="button"
          onClick={closeCheckIn}
          className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors"
        >
          Close check-in
        </button>
      </div>
    </Modal>
  );
}
