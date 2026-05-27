import { useMemo } from "react";
import { Link } from "react-router";
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
 * Page-level presence indicator: an overlapping avatar stack with photos
 * (initials fallback), a hover card per peer, and click-to-profile.
 *
 * Reads from the surrounding <PresenceProvider>; renders nothing if none is
 * in tree, or if the only peer present is the local user.
 */
export function PresenceBar({ className, max = 4 }: PresenceBarProps) {
  const ctx = usePresence();
  const peers = ctx?.peers;

  const visiblePeers = useMemo<Peer[]>(() => {
    if (!peers) return [];
    // Dedupe key prefers userId (stable across tabs/renames). Falls back to
    // name+color for peers broadcast before the infra upgrade landed. Keep
    // the active record over an idle dupe, and the "me" record over others.
    const seen = new Map<string, Peer>();
    for (const p of peers) {
      const key = p.userId ? `id:${p.userId}` : `nc:${p.name}|${p.color}`;
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
  const remoteCount = visiblePeers.filter((p) => !p.isMe).length;
  if (remoteCount === 0 && ctx.connected) return null;

  const shown = visiblePeers.slice(0, max);
  const overflow = Math.max(0, visiblePeers.length - shown.length);

  return (
    <div
      className={`inline-flex items-center gap-2 text-xs text-muted-foreground/70 ${className ?? ""}`}
    >
      {!ctx.connected && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"
          aria-label="Connecting to presence"
        />
      )}
      <div className="flex items-center -space-x-1.5">
        {shown.map((p) => (
          <PresenceChip
            key={p.clientId}
            peer={p}
            onFollow={ctx.followPeer}
          />
        ))}
        {overflow > 0 && (
          <span
            className="relative inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-muted-foreground bg-muted ring-2 ring-white"
            title={`${overflow} more`}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}

function ChipAvatar({ peer }: { peer: Peer }) {
  if (peer.photoUrl) {
    return (
      <img
        src={peer.photoUrl}
        alt=""
        className="w-full h-full rounded-full object-cover"
        draggable={false}
      />
    );
  }
  return (
    <span
      className="w-full h-full rounded-full flex items-center justify-center text-white text-[10px] font-semibold"
      style={{ backgroundColor: peer.color }}
    >
      {initialsFromName(peer.name)}
    </span>
  );
}

function PresenceChip({
  peer,
  onFollow,
}: {
  peer: Peer;
  onFollow: (clientId: number) => void;
}) {
  const followable = !peer.isMe && !!peer.currentEditor;
  const linkable = !!peer.userId && !peer.isMe;
  const idleClass = peer.idle ? "opacity-50" : "opacity-100";
  const interactiveClass =
    linkable || peer.isMe
      ? "cursor-pointer hover:z-10 hover:scale-110"
      : "cursor-default";

  const chipInner = (
    <span
      className={`relative inline-flex items-center justify-center w-6 h-6 rounded-full overflow-hidden ring-2 ring-white transition-transform ${interactiveClass} ${idleClass}`}
    >
      <ChipAvatar peer={peer} />
    </span>
  );

  return (
    <div className="relative group">
      {linkable ? (
        <Link
          to={`/members/${peer.userId}`}
          aria-label={`View ${peer.name}'s profile`}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground rounded-full"
        >
          {chipInner}
        </Link>
      ) : peer.isMe && peer.userId ? (
        <Link
          to={`/members/${peer.userId}`}
          aria-label="Your profile"
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground rounded-full"
        >
          {chipInner}
        </Link>
      ) : (
        chipInner
      )}
      <HoverCard peer={peer} followable={followable} onFollow={onFollow} />
    </div>
  );
}

function HoverCard({
  peer,
  followable,
  onFollow,
}: {
  peer: Peer;
  followable: boolean;
  onFollow: (clientId: number) => void;
}) {
  const meTag = peer.isMe ? " (you)" : "";
  const idleTag = peer.idle ? " · idle" : "";

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
    >
      <div className="pointer-events-auto min-w-[12rem] max-w-[16rem] rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-2.5 text-left">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 shrink-0 rounded-full overflow-hidden">
            <ChipAvatar peer={peer} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">
              {peer.name}
              <span className="text-muted-foreground font-normal">
                {meTag}
                {idleTag}
              </span>
            </div>
            {peer.subtitle && (
              <div className="text-[11px] text-muted-foreground truncate">
                {peer.subtitle}
              </div>
            )}
          </div>
        </div>
        {!peer.isMe && (peer.userId || followable) && (
          <div className="mt-2 flex items-center gap-2">
            {peer.userId && (
              <Link
                to={`/members/${peer.userId}`}
                className="text-[11px] text-foreground underline-offset-2 hover:underline"
              >
                View profile →
              </Link>
            )}
            {followable && (
              <button
                type="button"
                onClick={() => onFollow(peer.clientId)}
                className="text-[11px] text-foreground underline-offset-2 hover:underline"
              >
                Jump to cursor
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
