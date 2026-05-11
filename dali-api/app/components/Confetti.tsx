import { useEffect } from "react";

interface ConfettiProps {
  trigger: boolean;
  onFire?: () => void;
}

export type ConfettiAction = "fire" | "skip-reduced-motion" | "noop";

// Pure decision helper kept separate so it can be unit-tested without a DOM.
export function decideConfettiAction(
  trigger: boolean,
  prefersReducedMotion: boolean,
): ConfettiAction {
  if (!trigger) return "noop";
  if (prefersReducedMotion) return "skip-reduced-motion";
  return "fire";
}

function userPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Confetti({ trigger, onFire }: ConfettiProps) {
  useEffect(() => {
    const action = decideConfettiAction(trigger, userPrefersReducedMotion());
    if (action === "noop") return;
    if (action === "skip-reduced-motion") {
      onFire?.();
      return;
    }

    let cancelled = false;
    void import("canvas-confetti").then(mod => {
      if (cancelled) return;
      const confetti = mod.default;
      const duration = 800;
      const end = Date.now() + duration;
      (function frame() {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
        });
        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      })();
      onFire?.();
    });

    return () => {
      cancelled = true;
    };
  }, [trigger, onFire]);

  return null;
}
