import { useEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";

// A slim top-of-viewport progress bar shown during client-side route
// transitions. Mounted once at the document root (root.tsx), so it covers
// every page — the applicant portal, the main shell, and the pages loaded
// inside each workspace iframe (each iframe is its own document and runs its
// own copy of this bar).
//
// The bar eases toward — but never reaches — 100% while loading (real
// completion time is unknown), then snaps to full and fades out once the
// navigation settles. A short entry delay avoids flashing the bar for
// instant transitions.
export function NavigationProgress() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

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
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[100] h-0.5 pointer-events-none"
    >
      <div
        className="h-full bg-grad-teal shadow-[0_0_8px_var(--color-accent-teal)] transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}
