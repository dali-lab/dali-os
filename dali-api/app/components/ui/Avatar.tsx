import { cn } from "~/lib/cn";
import { initialsFromName } from "~/lib/display";
import { Tooltip } from "~/components/ui/floating";
import { useAvatarStatus } from "~/components/presence/PresenceStatusProvider";
import { useFeatureFlag } from "~/components/FeatureFlags";
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

/**
 * Tint for an initials placeholder standing in for a missing photo.
 *
 * The os shell deliberately leaves coral unmapped (it's the brand's, and the
 * primary button needs it), but a coral-tinted chip on every photoless person
 * reads as pink chrome the palette doesn't have. Under the flag these take the
 * same neutral tint the partner org placeholders already use. Exported so the
 * larger profile-page placeholders stay in step with the avatar.
 */
export function useInitialsTint(): string {
  const os = useFeatureFlag("os-redesign");
  return os ? "bg-brand-tint text-dark-blue" : "bg-accent-coral/15 text-accent-coral";
}

export function Avatar({ photoUrl, name, size = "md", className, userId }: AvatarProps) {
  // Only sizes that have visual weight warrant a presence dot; xs contexts
  // (stacked avatar groups, tight lists) are too small and too numerous.
  const showDot = !!userId && size !== "xs";
  const tint = useInitialsTint();

  const avatarEl = photoUrl ? (
    <img
      src={photoUrl}
      alt={name}
      className={cn("rounded-full object-cover", SIZES[size], className)}
    />
  ) : (
    <div
      className={cn(
        "font-medium rounded-full flex items-center justify-center",
        tint,
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
    <Tooltip content={tooltipLabel} placement="top">
      {wrapper}
    </Tooltip>
  );
}
