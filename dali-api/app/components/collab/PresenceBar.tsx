import { useMemo } from "react";
import { usePresence, type Peer } from "./PresenceProvider";
import { initialsFromName } from "./util";

interface PresenceBarProps {
  className?: string;
  /**
   * Maximum avatars to show before collapsing into a "+N" chip.
   * Defaults to 4.
   */
  max?: number;
}

/**
 * Minimal page-level presence indicator: an overlapping avatar stack with
 * a tiny connection dot. No card chrome, no sticky positioning — meant to
 * be tucked inline (e.g. into a header row), Notion-style.
 *
 * Reads from the surrounding <PresenceProvider>; renders nothing if none is
 * in tree, or if the only peer is "me".
 */
export function PresenceBar({ className, max = 4 }: PresenceBarProps) {
  const ctx = usePresence();
  const peers = ctx?.peers;

  const visiblePeers = useMemo<Peer[]>(() => {
    if (!peers) return [];
    // Dedupe by name+color so multiple tabs from the same human collapse.
    // Prefer active over idle, and the "me" record over duplicates.
    const seen = new Map<string, Peer>();
    for (const p of peers) {
      const key = `${p.name}|${p.color}`;
      const existing = seen.get(key);
      if (
        !existing ||
        (existing.idle && !p.idle) ||
        (!existing.isMe && p.isMe)
      ) {
        seen.set(key, p);
      }
    }
    return Array.from(seen.values()).sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      if (a.idle !== b.idle) return a.idle ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [peers]);

  if (!ctx) return null;
  // Hide entirely when nobody else is here.
  if (visiblePeers.length <= 1 && ctx.connected) return null;

  const shown = visiblePeers.slice(0, max);
  const overflow = Math.max(0, visiblePeers.length - shown.length);

  return (
    <div
      className={`inline-flex items-center gap-2 text-xs text-gray-400 ${className ?? ""}`}
      title={
        ctx.connected
          ? `${visiblePeers.length} viewing`
          : "Connecting to presence..."
      }
    >
      {!ctx.connected && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"
          aria-label="Connecting"
        />
      )}
      <div className="flex items-center -space-x-1.5">
        {shown.map((p) => {
          const followable = !p.isMe && !!p.currentEditor;
          const tooltip = p.isMe
            ? `${p.name} (you)`
            : !p.currentEditor
              ? `${p.name}${p.idle ? " (idle)" : ""}`
              : `${p.name}${p.idle ? " (idle)" : ""} — click to jump to their cursor`;
          return (
            <button
              key={p.clientId}
              type="button"
              onClick={() => followable && ctx.followPeer(p.clientId)}
              disabled={!followable}
              title={tooltip}
              className={`relative inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white ring-2 ring-white transition-transform ${
                followable
                  ? "cursor-pointer hover:z-10 hover:scale-110"
                  : "cursor-default"
              } ${p.idle ? "opacity-50" : "opacity-100"}`}
              style={{ backgroundColor: p.color }}
            >
              {initialsFromName(p.name)}
            </button>
          );
        })}
        {overflow > 0 && (
          <span
            className="relative inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-gray-600 bg-gray-200 ring-2 ring-white"
            title={`${overflow} more`}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
