import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, Loader2, Mic } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";
import { stopLiveSession, useLiveSession, useLiveSessionBoot, type LiveSession } from "./live-session";
import { formatClock } from "./transcript";

export const RECORDING_FAVICON = "/icon-blue-recording.svg";

export function useRecordingFavicon(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const original = link.getAttribute("href");
    link.setAttribute("href", RECORDING_FAVICON);
    return () => {
      if (original !== null) link.setAttribute("href", original);
    };
  }, [active]);
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}

const SHELL = "mr-1 flex h-[30px] min-w-0 shrink-0 items-center gap-2 rounded-full border pl-3 pr-1 text-xs";

function Title({ session, className }: { session: LiveSession; className?: string }) {
  const classes = cn("hidden max-w-[140px] truncate text-os-grey md:inline", className);
  if (!session.href) return <span className={classes}>{session.title}</span>;
  return (
    <Link to={session.href} className={cn(classes, "hover:text-foreground")}>
      {session.title}
    </Link>
  );
}

function StopButton() {
  return (
    <Tooltip content="Stop recording">
      <button
        type="button"
        aria-label="Stop recording"
        onClick={() => void stopLiveSession()}
        className="group/stop flex h-6 items-center gap-1.5 rounded-full border border-os-container bg-os-card px-2.5 shadow-sm transition-colors hover:border-os-red hover:bg-os-red"
      >
        <span className="h-[9px] w-[9px] rounded-[2px] bg-os-red group-hover/stop:bg-white" />
        <span className="hidden font-semibold text-foreground group-hover/stop:text-white sm:inline">Stop</span>
      </button>
    </Tooltip>
  );
}

export function RecordingPill() {
  const session = useLiveSession();
  const enabled = useFeatureFlag("ai-meeting-notes");
  const { pathname } = useLocation();
  const now = useNow(session?.status === "recording");
  useLiveSessionBoot(enabled);
  const capturing = session?.status === "starting" || session?.status === "recording" || session?.status === "stopping";
  useRecordingFavicon(enabled && capturing);

  if (!enabled || !session) return null;
  if (session.href && pathname === session.href) return null;

  if (session.status === "stopping") {
    return (
      <div className={cn(SHELL, "border-transparent pr-3 text-os-grey")}>
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        <span className="font-semibold">Stopping</span>
        <Title session={session} />
      </div>
    );
  }

  if (session.status === "stopped") {
    return (
      <div className={cn(SHELL, "border-os-container")}>
        <Mic aria-hidden className="h-3.5 w-3.5 shrink-0 text-os-accent" />
        <Title session={session} className="text-foreground" />
        {session.href ? (
          <Link
            to={session.href}
            className="flex h-6 items-center gap-1 rounded-full bg-os-accent px-3 font-semibold text-white transition-opacity hover:opacity-90"
          >
            Finish in note
            <ArrowRight aria-hidden className="h-3 w-3" />
          </Link>
        ) : (
          <span className="pr-2 font-semibold text-foreground">Stopped</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn(SHELL, "border-os-container")}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-os-red motion-safe:animate-pulse" />
      <span className="font-bold tabular-nums text-os-red">
        {session.status === "starting" ? "Starting" : formatClock((now - session.startedAt) / 1000)}
      </span>
      {session.noSound && <span className="shrink-0 font-semibold text-destructive">No sound</span>}
      <Title session={session} />
      <StopButton />
    </div>
  );
}
