import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigation } from "react-router";
import { subscribeTabs, tabsActive } from "~/lib/desktop-tabs-store";
import { areaForPath, areaTint } from "~/lib/nav-areas";
import { cn } from "~/lib/cn";

// A slim progress bar shown during client-side route transitions. Mounted once
// at the document root (root.tsx), so it covers every page — the applicant
// portal, the main shell, and the pages loaded inside each workspace iframe
// (each iframe is its own document and runs its own copy of this bar).
//
// The bar eases toward — but never reaches — 100% while loading (real
// completion time is unknown), then snaps to full and fades out once the
// navigation settles. A short entry delay avoids flashing the bar for
// instant transitions.
//
// In the desktop app the tab strip hosts its own copy along its bottom edge
// (loading belongs to the tab, like a browser), and this root bar stands down.
export function NavigationProgress() {
  const inTabStrip = useSyncExternalStore(subscribeTabs, tabsActive, () => false);
  if (inTabStrip) return null;
  return <NavigationProgressBar className="fixed inset-x-0 top-0 z-[100]" />;
}

export function NavigationProgressBar({ className }: { className?: string }) {
  const navigation = useNavigation();
  const location = useLocation();
  const isLoading = navigation.state !== "idle";

  // The bar wears the color of the mode being loaded — the destination's area
  // tint (the same `--area` accent the rail uses), not a fixed accent. Pages
  // outside any area (portal, auth, home) keep the default accent. Resolved
  // from the path alone: this mounts at the document root, above the shell
  // div that carries `--area`.
  const target = navigation.location ?? location;
  const area = areaForPath(`${target.pathname}${target.search}`);
  const color = area ? areaTint(area.key) : "var(--color-os-accent)";

  // visible drives mount + fade; progress is the width %.
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTrickle = () => {
      if (trickleRef.current) {
        clearInterval(trickleRef.current);
        trickleRef.current = null;
      }
    };

    if (isLoading) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      // Don't flash for transitions that resolve almost immediately.
      showTimerRef.current = setTimeout(() => {
        setVisible(true);
        setProgress(8);
        clearTrickle();
        // Trickle toward 90% with diminishing steps so it always looks like
        // progress without ever completing on its own.
        trickleRef.current = setInterval(() => {
          setProgress((p) => (p >= 90 ? p : p + (90 - p) * 0.12));
        }, 200);
      }, 120);

      return () => {
        if (showTimerRef.current) clearTimeout(showTimerRef.current);
      };
    }

    // Settled. Cancel a pending show; if the bar is up, complete and fade it.
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    clearTrickle();
    setVisible((wasVisible) => {
      if (!wasVisible) return false;
      setProgress(100);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 280);
      return true;
    });
  }, [isLoading]);

  useEffect(
    () => () => {
      if (trickleRef.current) clearInterval(trickleRef.current);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  if (!visible && progress === 0) return null;

  return (
    <div aria-hidden className={cn("pointer-events-none h-0.5", className)}>
      <div
        className="h-full transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}`,
        }}
      />
    </div>
  );
}
