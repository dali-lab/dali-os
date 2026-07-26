import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Maximize2, Minimize2, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";

// Rendered above AttendanceChecklist on a meeting-note page whose
// ScheduledMeeting.attendanceMode is "SelfCheckIn" — an alternative to
// checking a big roster off by hand. Two independent pieces, each gated by
// who's viewing:
//   - The check-in button: shown to any invited viewer (they got here either
//     by scanning the QR/link below, or just by opening the note directly).
//     POSTs to the check-in route, which resolves the userId from their own
//     session — never from anything in this component's props.
//   - The QR/link card: shown only to the organizer/Core (canMark upstream),
//     for them to display or share so attendees can scan it at the event.
export function CheckInPanel({
  meetingId,
  meetingLabel,
  viewerInvited,
  initialPresent,
  checkInUrl,
  checkInQrSvg,
}: {
  meetingId: string;
  meetingLabel: string;
  viewerInvited: boolean;
  initialPresent: boolean;
  checkInUrl: string | null;
  checkInQrSvg: string | null;
}) {
  const [present, setPresent] = useState(initialPresent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  async function checkIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/scheduled-meetings/${meetingId}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Check-in failed");
        return;
      }
      setPresent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {viewerInvited && (
        <section className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading font-semibold text-foreground">{meetingLabel}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {present ? "You're checked in." : "Check in to mark yourself present."}
            </p>
            {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
          </div>
          <button
            type="button"
            onClick={checkIn}
            disabled={present || submitting}
            className="px-4 py-2 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {present ? "Checked in" : submitting ? "Checking in…" : "Check in"}
          </button>
        </section>
      )}
      {checkInUrl && checkInQrSvg && (
        <section className="bg-card border border-border rounded-lg p-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="w-24 h-24 flex-shrink-0 [&_svg]:w-full [&_svg]:h-full rounded-md hover:ring-2 hover:ring-accent-coral/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40"
            aria-label="Open QR code fullscreen"
            title="Open fullscreen"
            dangerouslySetInnerHTML={{ __html: checkInQrSvg }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Self check-in</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Display this QR code at the event, or share the link — attendees who scan/open it
              (while signed in) mark themselves present within the check-in window.
            </p>
            <a
              href={checkInUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-teal hover:underline break-all"
            >
              {checkInUrl}
            </a>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                className={buttonClasses("secondary", "sm")}
              >
                <Maximize2 className="w-3.5 h-3.5" aria-hidden />
                Fullscreen
              </button>
              <a
                href={`/api/scheduled-meetings/${meetingId}/check-in-qr.pdf`}
                className={buttonClasses("secondary", "sm")}
              >
                <Download className="w-3.5 h-3.5" aria-hidden />
                Download PDF
              </a>
            </div>
          </div>
        </section>
      )}
      {qrOpen && checkInUrl && checkInQrSvg && (
        <QrFullscreenOverlay
          meetingLabel={meetingLabel}
          checkInUrl={checkInUrl}
          checkInQrSvg={checkInQrSvg}
          meetingId={meetingId}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}

function QrFullscreenOverlay({
  meetingLabel,
  checkInUrl,
  checkInQrSvg,
  meetingId,
  onClose,
}: {
  meetingLabel: string;
  checkInUrl: string;
  checkInQrSvg: string;
  meetingId: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  const exitNativeFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore — some browsers reject if not currently fullscreen
      }
    }
  }, []);

  const close = useCallback(async () => {
    await exitNativeFullscreen();
    onClose();
  }, [exitNativeFullscreen, onClose]);

  const toggleNativeFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Fullscreen API unavailable or denied — overlay is still usable.
    }
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        void close();
      }
    };
    const onFullscreenChange = () => {
      setIsNativeFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [close]);

  // Enter browser fullscreen on open so the QR fills the projector/display.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !el.requestFullscreen) return;
    void el.requestFullscreen().catch(() => {
      // Permission denied or unsupported — stay in the page overlay.
    });
    return () => {
      if (document.fullscreenElement === el) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex flex-col bg-white text-foreground"
      role="dialog"
      aria-modal="true"
      aria-labelledby="check-in-qr-fullscreen-title"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Self check-in
          </p>
          <h2
            id="check-in-qr-fullscreen-title"
            className="font-heading text-lg font-bold truncate"
          >
            {meetingLabel}
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={`/api/scheduled-meetings/${meetingId}/check-in-qr.pdf`}
            className={buttonClasses("secondary", "sm")}
          >
            <Download className="w-3.5 h-3.5" aria-hidden />
            PDF
          </a>
          <button
            type="button"
            onClick={() => void toggleNativeFullscreen()}
            className={buttonClasses("secondary", "sm")}
            aria-label={isNativeFullscreen ? "Exit display fullscreen" : "Enter display fullscreen"}
          >
            {isNativeFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" aria-hidden />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" aria-hidden />
            )}
            {isNativeFullscreen ? "Exit" : "Fullscreen"}
          </button>
          <button
            type="button"
            onClick={() => void close()}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground rounded p-1.5 hover:bg-muted"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 overflow-auto">
        <div
          className="w-[min(72vmin,560px)] h-[min(72vmin,560px)] [&_svg]:w-full [&_svg]:h-full"
          dangerouslySetInnerHTML={{ __html: checkInQrSvg }}
        />
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Scan while signed in to mark yourself present.
        </p>
        <p className="text-xs text-muted-foreground/80 break-all text-center max-w-lg">
          {checkInUrl}
        </p>
      </div>
    </div>
  );
}
