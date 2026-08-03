import { cn } from "~/lib/cn";
import { initialsFromName } from "~/lib/display";
import { Tooltip } from "~/components/ui/IconButton";
import { useAvatarStatus } from "~/components/presence/PresenceStatusProvider";
import { formatLastActive } from "~/lib/presence";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface AvatarProps {
  photoUrl?: string | null;
  name: string;
  size?: AvatarSize;
  className?: string;
  /** When provided and size is sm/md/lg, renders a live presence dot. */
  userId?: string;
}

const SIZES: Record<AvatarSize, string> = {
  xs: "w-5 h-5 text-[9px]",
  sm: "w-8 h-8 text-[11px]",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

// Dot size scales with avatar size.
const DOT_SIZE: Partial<Record<AvatarSize, string>> = {
  sm: "w-2.5 h-2.5",
  md: "w-3 h-3",
  lg: "w-3.5 h-3.5",
};

export function Avatar({ photoUrl, name, size = "md", className, userId }: AvatarProps) {
  // Only sizes that have visual weight warrant a presence dot; xs contexts
  // (stacked avatar groups, tight lists) are too small and too numerous.
  const showDot = !!userId && size !== "xs";

  const avatarEl = photoUrl ? (
    <img
      src={photoUrl}
      alt={name}
      className={cn("rounded-full object-cover", SIZES[size], className)}
    />
  ) : (
    <div
      className={cn(
        "bg-accent-coral/15 text-accent-coral font-medium rounded-full flex items-center justify-center",
        SIZES[size],
        className,
      )}
      aria-label={name}
    >
      {initialsFromName(name)}
    </div>
  );

  if (!showDot) return avatarEl;

  return (
    <AvatarWithStatus userId={userId!} size={size} name={name}>
      {avatarEl}
    </AvatarWithStatus>
  );
}

// Separated so the hook only runs when showDot is true (avoids context cost
// for xs/utility avatars that never show a dot).
function AvatarWithStatus({
  userId,
  size,
  name,
  children,
}: {
  userId: string;
  size: AvatarSize;
  name: string;
  children: React.ReactNode;
}) {
  const status = useAvatarStatus(userId);
  const now = new Date();

  const tooltipLabel =
    status?.state === "active"
      ? "Active now"
      : status?.lastActiveAt
        ? formatLastActive(new Date(status.lastActiveAt), now) ?? undefined
        : undefined;

  const dotEl =
    status?.state === "active" ? (
      // Solid green dot for active.
      <span
        aria-hidden
        className={cn(
          "absolute bottom-0 right-0 rounded-full bg-accent-green ring-2 ring-background",
          DOT_SIZE[size],
        )}
      />
    ) : status?.state === "recent" ? (
      // Hollow amber ring for recent.
      <span
        aria-hidden
        className={cn(
          "absolute bottom-0 right-0 rounded-full border-2 border-accent-yellow bg-background ring-2 ring-background",
          DOT_SIZE[size],
        )}
      />
    ) : null;

  if (!dotEl) {
    return <span className="relative inline-flex">{children}</span>;
  }

  const wrapper = (
    <span className="relative inline-flex">
      {children}
      {dotEl}
    </span>
  );

  if (!tooltipLabel) return wrapper;

  return (
    // portal: avatars often sit inside overflow-clipped scroll panes (the
    // directory table, tight lists) — without it the tip is cut off at the edge.
    <Tooltip label={tooltipLabel} side="top" portal>
      {wrapper}
    </Tooltip>
  );
}
