import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

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
//
// This component owns the MediaStream for BOTH paths (zxing decodes from the
// already-playing <video> rather than opening its own stream) so there is
// exactly one place that starts and stops the camera. When two overlapping
// starts raced — React's StrictMode double-effect, or a fast remount — the
// loser's teardown used to null out the winner's srcObject and leave a black
// box that still claimed to be "scanning". `runIdRef` makes every start check
// that it is still the current one before touching the video element.

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
// A camera that has produced no frame by now is not going to; surface it as an
// error with a retry rather than spinning on "Starting camera…" forever.
const FIRST_FRAME_TIMEOUT_MS = 10000;

/**
 * Turn a getUserMedia/play rejection into something an organizer standing at a
 * door can act on. The raw DOMException names ("NotReadableError") tell them
 * nothing; "another app has the camera" tells them to quit Zoom.
 */
function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access is blocked for this site. Allow the camera in your browser's site settings, then reload.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "Another app is using the camera. Quit it (Zoom, Photo Booth, another tab) and try again.";
    case "OverconstrainedError":
      return "This device's camera doesn't support the requested mode.";
    case "AbortError":
      return "The camera stopped before it could start. Try again.";
    default:
      return err instanceof Error && err.message ? err.message : "Could not start the camera.";
  }
}

/**
 * Prefer the rear camera on phones, but never fail over it — `facingMode` is an
 * ideal, not `exact`, and laptops (the common scan station) only have a front
 * camera. A device that still rejects gets a second, unconstrained attempt.
 */
async function openCameraStream(): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  try {
    return await media.getUserMedia({ video: { facingMode: "environment" } });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name !== "OverconstrainedError" && name !== "NotFoundError") throw err;
    return await media.getUserMedia({ video: true });
  }
}

/**
 * Resolve once the video is actually painting frames. `play()` resolving is not
 * enough — Safari resolves it with a 0x0 video that never renders — so wait for
 * real dimensions before claiming the scanner is live.
 */
function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      video.removeEventListener("loadedmetadata", onFrame);
      video.removeEventListener("playing", onFrame);
      window.clearTimeout(timer);
      fn();
    };
    function onFrame() {
      if (video.videoWidth > 0 && video.videoHeight > 0) done(resolve);
    }
    const timer = window.setTimeout(
      () => done(() => reject(new Error("The camera never delivered a picture. Try again."))),
      FIRST_FRAME_TIMEOUT_MS,
    );
    video.addEventListener("loadedmetadata", onFrame);
    video.addEventListener("playing", onFrame);
  });
}

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
  // Bumped by the retry button to re-run the start effect.
  const [attempt, setAttempt] = useState(0);

  // A scan in flight (block concurrent POSTs) and per-token throttle so one
  // physical pass held to the camera ≈ one mark, not a burst.
  const busyRef = useRef(false);
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  // Identifies the current start; a stale run must not touch the video.
  const runIdRef = useRef(0);

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

    const runId = ++runIdRef.current;
    const isCurrent = () => runIdRef.current === runId;

    let stream: MediaStream | null = null;
    let intervalId: number | null = null;
    let stopDecoder: (() => void) | null = null;

    function fail(message: string) {
      if (!isCurrent()) return;
      setStatus("error");
      setCameraError(message);
    }

    async function start() {
      setStatus("starting");
      setCameraError(null);

      // getUserMedia only exists in a secure context. Served over plain http on
      // a LAN IP (a phone pointed at a dev laptop) `mediaDevices` is undefined
      // and the naive call throws an unreadable TypeError.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        fail("The camera needs a secure (https) connection. Open this page over https or on localhost.");
        return;
      }

      try {
        stream = await openCameraStream();
        if (!isCurrent()) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        video!.srcObject = stream;
        // Autoplay of a muted, inline stream is allowed, but a rejection here
        // is why the box would otherwise sit black forever — surface it.
        try {
          await video!.play();
        } catch (err) {
          if (!isCurrent()) return;
          throw err;
        }
        await waitForFirstFrame(video!);
        if (!isCurrent()) return;

        setStatus("scanning");

        const Detector = (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor })
          .BarcodeDetector;
        if (Detector) {
          const detector = new Detector({ formats: ["qr_code"] });
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
          if (!isCurrent()) return;
          // Decode from the element we already started, so zxing never opens or
          // closes a stream of its own.
          const controls = await new BrowserQRCodeReader().decodeFromVideoElement(video!, (res) => {
            if (res) void handleToken(res.getText());
          });
          if (!isCurrent()) controls.stop();
          else stopDecoder = () => controls.stop();
        }
      } catch (err) {
        if (!isCurrent()) return;
        fail(describeCameraError(err));
      }
    }

    void start();
    return () => {
      // Mark this run stale first: anything still in flight above now bails out
      // instead of writing to a video element the next run may already own.
      if (runIdRef.current === runId) runIdRef.current++;
      if (intervalId) window.clearInterval(intervalId);
      if (stopDecoder) stopDecoder();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      // Only release the element if this run is the one holding it.
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [disabled, handleToken, attempt]);

  return (
    <div className="relative w-full max-w-md mx-auto aspect-square rounded-2xl overflow-hidden bg-black border border-border">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        muted
        autoPlay
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <XCircle className="w-8 h-8 text-red-400" aria-hidden />
          <p className="text-sm">{cameraError}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium hover:bg-white/10"
          >
            <RefreshCw className="w-4 h-4" aria-hidden /> Try again
          </button>
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
