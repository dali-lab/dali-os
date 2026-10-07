import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Clock } from "lucide-react";
import { Button } from "~/components/ui/Button";
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
      <div className="cal-surface flex flex-col gap-3 rounded-os-card border border-os-container bg-os-card p-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-os-grey">
            <Clock className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Update time zone
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your device is in{" "}
              <span className="font-medium text-foreground">
                {formatZoneLabel(detected!)}
              </span>
              . Times currently show in {formatZoneLabel(userTimeZone)}.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={update} disabled={busy}>
            Update
          </Button>
          <Button variant="secondary" size="sm" onClick={keep} disabled={busy}>
            Keep {formatZoneLabel(userTimeZone).split(" · ")[0]}
          </Button>
        </div>
      </div>
    </div>
  );
}
