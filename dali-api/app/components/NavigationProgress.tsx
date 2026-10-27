import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigation } from "react-router";
import { useDisplayedTab } from "~/components/shell/displayed-tab";
import { subscribeTabStrip, tabStripShowing } from "~/lib/desktop-tabs-store";
import { areaForPath, areaInk, areaTint } from "~/lib/nav-areas";
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
export function NavigationProgress() {
  // While the desktop tab strip is on screen the shell renders the bar itself
  // (DockedNavigationProgress, under the page bar's breadcrumb) so it starts
  // after the sidebar instead of running over it.
  const underTabStrip = useSyncExternalStore(subscribeTabStrip, tabStripShowing, () => false);
  if (underTabStrip) return null;
  return <ProgressBar className="fixed inset-x-0 top-0 z-[100]" />;
}

// Mounted by the shell at the bottom edge of its sticky header while the tab
// strip is showing. The header lives inside the main column, which is padded
// past the rail, so the bar spans only the page area, just under the
// breadcrumb bar.
export function DockedNavigationProgress() {
  return <ProgressBar className="absolute inset-x-0 bottom-0 z-10" />;
}

function ProgressBar({ className }: { className: string }) {
  const navigation = useNavigation();
  const location = useLocation();
  // A switch to a kept tab shows that page instantly, so no loading bar.
  const showingKeptTab = useDisplayedTab() !== null;
  const isTabSwitch = (navigation.location?.state as { tabSwitch?: boolean } | null)?.tabSwitch === true;
  const isLoading = navigation.state !== "idle" && !(isTabSwitch && showingKeptTab);

  // Under the v2 design (the data-v2 marker root.tsx sets from the
  // desktop-tabs flag) the bar wears the color of the mode being loaded — the
  // destination's area tint. Otherwise, and on pages outside any area
  // (portal, auth, home), it keeps the default accent. Resolved from the path
  // alone: this mounts at the document root, above the shell div that carries
  // `--area`, and outside the flag provider.
  const v2 =
    typeof document !== "undefined" &&
    document.documentElement.hasAttribute("data-v2");
  // The tints are picked as ink on the dark shell; light mode takes the
  // area's ink instead, same as the rail's `--area` resolution in app.css.
  const light =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("light");
  const target = navigation.location ?? location;
  const area = v2 ? areaForPath(`${target.pathname}${target.search}`) : undefined;
  const color = area
    ? light
      ? areaInk(area.key)
      : areaTint(area.key)
    : "var(--color-os-accent)";

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
    <div aria-hidden className={cn("h-0.5 pointer-events-none", className)}>
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
