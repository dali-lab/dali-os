import { useRetro } from "~/lib/party";

/**
 * Small fixed-corner button that lets a user disable retro mode without
 * needing to dig through localStorage. Renders nothing when retro is off.
 */
export function RetroExitPill() {
  const [on, setOn] = useRetro();

  if (!on) return null;

  return (
    <button
      type="button"
      onClick={() => setOn(false)}
      aria-label="Exit retro mode"
      className="fixed bottom-4 right-4 z-50 px-3 py-1.5 rounded-full border border-border bg-card/80 backdrop-blur-sm text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-card opacity-60 hover:opacity-100 transition shadow-sm"
    >
      ✕ exit retro mode
    </button>
  );
}
