import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, XCircle } from "lucide-react";

// Organizer/kiosk scan station for wallet-pass check-in. The member shows their
// DALI membership pass; this reads the QR barcode and POSTs the signed token to
// the scan-attendee endpoint, which marks that member present. The inverse of
// self-check-in — the operator's own session is the authority to mark others,
// so this whole surface is only reachable behind the operator gate in the route
// loader.
//
// Two decode paths: the native BarcodeDetector (Chromium / Android) when it
// exists, and an @zxing/browser fallback (Safari/iOS/desktop-Safari ship no
// BarcodeDetector, and DALI runs Apple-heavy, so the fallback is the common
// path). Both require a secure context — fine in prod and on localhost.

type ScanResult =
  | { kind: "success"; member: { firstName: string; lastName: string; photoUrl: string | null } }
  | { kind: "error"; message: string };

// Minimal shape of the native BarcodeDetector (absent from the TS DOM lib).
type NativeBarcodeDetector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};
type NativeBarcodeDetectorCtor = new (opts: { formats: string[] }) => NativeBarcodeDetector;

const RESCAN_DEBOUNCE_MS = 3000;
const FEEDBACK_MS = 2500;

export function AttendeeScanner({
  meetingId,
  disabled,
}: {
  meetingId: string;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  // A scan in flight (block concurrent POSTs) and per-token throttle so one
  // physical pass held to the camera ≈ one mark, not a burst.
  const busyRef = useRef(false);
  const lastSeenRef = useRef<Map<string, number>>(new Map());

  const handleToken = useCallback(
    async (token: string) => {
      const now = Date.now();
      if (busyRef.current) return;
      const last = lastSeenRef.current.get(token) ?? 0;
      if (now - last < RESCAN_DEBOUNCE_MS) return;
      lastSeenRef.current.set(token, now);
      busyRef.current = true;
      try {
        const res = await fetch(`/api/scheduled-meetings/${meetingId}/scan-attendee`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ memberToken: token }),
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          member?: { firstName: string; lastName: string; photoUrl: string | null };
          error?: string;
        } | null;
        if (res.ok && body?.ok && body.member) {
          setResult({ kind: "success", member: body.member });
        } else {
          setResult({ kind: "error", message: body?.error ?? "Scan failed" });
        }
      } catch {
        setResult({ kind: "error", message: "Network error — try again" });
      } finally {
        busyRef.current = false;
      }
    },
    [meetingId],
  );

  // Clear the feedback card a beat after each scan so the next person can go.
  useEffect(() => {
    if (!result) return;
    const t = window.setTimeout(() => setResult(null), FEEDBACK_MS);
    return () => window.clearTimeout(t);
  }, [result]);

  useEffect(() => {
    if (disabled) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let intervalId: number | null = null;
    let stopZxing: (() => void) | null = null;

    async function start() {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor })
          .BarcodeDetector;
        if (Detector) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video!.srcObject = stream;
          await video!.play().catch(() => {});
          const detector = new Detector({ formats: ["qr_code"] });
          setStatus("scanning");
          intervalId = window.setInterval(async () => {
            if (busyRef.current) return;
            try {
              const codes = await detector.detect(video!);
              const value = codes.find((c) => c.rawValue)?.rawValue;
              if (value) void handleToken(value);
            } catch {
              // Transient decode failures (no code in frame) are expected.
            }
          }, 350);
        } else {
          const { BrowserQRCodeReader } = await import("@zxing/browser");
          const reader = new BrowserQRCodeReader();
          setStatus("scanning");
          const controls = await reader.decodeFromConstraints(
            { video: { facingMode: "environment" } },
            video!,
            (res) => {
              if (res) void handleToken(res.getText());
            },
          );
          if (cancelled) controls.stop();
          else stopZxing = () => controls.stop();
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setCameraError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera and reload."
            : err instanceof Error
              ? err.message
              : "Could not start the camera.",
        );
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      if (stopZxing) stopZxing();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [disabled, handleToken]);

  return (
    <div className="relative w-full max-w-md mx-auto aspect-square rounded-2xl overflow-hidden bg-black border border-border">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        muted
        playsInline
      />

      {/* Reticle */}
      {status === "scanning" && !result && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-2/3 h-2/3 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      )}

      {status === "starting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
          <Camera className="w-8 h-8 animate-pulse" aria-hidden />
          <p className="text-sm">Starting camera…</p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-white">
          <XCircle className="w-8 h-8 text-red-400" aria-hidden />
          <p className="text-sm">{cameraError}</p>
        </div>
      )}

      {/* Scan feedback */}
      {result && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white ${
            result.kind === "success" ? "bg-emerald-600/90" : "bg-red-600/90"
          }`}
          role="status"
          aria-live="polite"
        >
          {result.kind === "success" ? (
            <>
              {result.member.photoUrl ? (
                <img
                  src={result.member.photoUrl}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover ring-2 ring-white"
                />
              ) : (
                <CheckCircle2 className="w-16 h-16" aria-hidden />
              )}
              <p className="text-xl font-heading font-bold">
                {result.member.firstName} {result.member.lastName}
              </p>
              <p className="text-sm opacity-90">Marked present</p>
            </>
          ) : (
            <>
              <XCircle className="w-14 h-14" aria-hidden />
              <p className="text-base font-medium">{result.message}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
