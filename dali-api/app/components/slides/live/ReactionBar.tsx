import { useEffect, useState } from "react";
import { cn } from "~/lib/cn";
import { REACTION_INTERVAL_MS, REACTIONS } from "./polls";

export function ReactionBar({ onReact }: { onReact: (emoji: string) => Promise<boolean> | boolean }) {
  const [cooling, setCooling] = useState(false);
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setCooling(false), REACTION_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [cooling]);
  return (
    <div role="group" aria-label="React" className="inline-flex items-center gap-1 rounded-full border border-os-container bg-os-card px-2 py-1 shadow-lg">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React ${emoji}`}
          disabled={cooling}
          onClick={() => {
            setCooling(true);
            void onReact(emoji);
          }}
          className={cn("rounded-full px-1.5 py-0.5 text-lg transition-transform hover:scale-110", cooling && "opacity-50")}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
