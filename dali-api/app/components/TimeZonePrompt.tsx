import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Clock } from "lucide-react";
import { formatZoneLabel, isValidTimezone } from "~/lib/timezone";

// Location-aware timezone nudge (Google-Calendar style). After mount it reads
// the browser's timezone and compares it to the stored preference:
//   • no stored zone yet → silently persist the detected zone (no prompt).
//   • stored zone differs and not already dismissed → offer to update.
// Detection runs only post-mount (never during render), so the server and the
// first client render agree — no hydration mismatch. All state that drives
// formatting is threaded from the layout loader; this component only reacts.
export function TimeZonePrompt({
  userTimeZone,
  userTimeZoneIsExplicit,
  dismissedZone,
}: {
  userTimeZone: string;
  userTimeZoneIsExplicit: boolean;
  dismissedZone: string | null;
}) {
  const fetcher = useFetcher();
  const [detected, setDetected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const silentFired = useRef(false);

  useEffect(() => {
    let browserTz: string | null = null;
    try {
      browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!isValidTimezone(browserTz)) return;

    // First-ever visit with no explicit preference: adopt the detected zone
    // silently, exactly once.
    if (!userTimeZoneIsExplicit) {
      if (silentFired.current) return;
      silentFired.current = true;
      fetcher.submit(
        { intent: "update", timeZone: browserTz },
        { method: "post", action: "/api/timezone/update" },
      );
      return;
    }

    setDetected(browserTz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTimeZone, userTimeZoneIsExplicit]);

  const shouldPrompt =
    !closed &&
    detected !== null &&
    detected !== userTimeZone &&
    detected !== dismissedZone;

  if (!shouldPrompt) return null;

  const busy = fetcher.state !== "idle";

  function update() {
    fetcher.submit(
      { intent: "update", timeZone: detected! },
      { method: "post", action: "/api/timezone/update" },
    );
    setClosed(true);
  }

  function keep() {
    fetcher.submit(
      { intent: "dismiss", timeZone: detected! },
      { method: "post", action: "/api/timezone/update" },
    );
    setClosed(true);
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 max-w-[calc(100vw-2rem)] pointer-events-auto">
      <div className="bg-card border border-border rounded-2xl shadow-brand-2 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-accent-coral">
            <Clock className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Update your timezone?
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              You look like you're in{" "}
              <span className="font-medium text-foreground">
                {formatZoneLabel(detected!)}
              </span>
              , but your times show in {formatZoneLabel(userTimeZone)}.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={update}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90 disabled:opacity-60"
          >
            Update
          </button>
          <button
            type="button"
            onClick={keep}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted/50 disabled:opacity-60"
          >
            Keep {formatZoneLabel(userTimeZone).split(" · ")[0]}
          </button>
        </div>
      </div>
    </div>
  );
}
