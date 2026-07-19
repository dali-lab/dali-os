import { cn } from "~/lib/cn";
import { initialsFromName } from "~/lib/display";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface AvatarProps {
  photoUrl?: string | null;
  name: string;
  size?: AvatarSize;
  className?: string;
}

const SIZES: Record<AvatarSize, string> = {
  xs: "w-5 h-5 text-[9px]",
  sm: "w-8 h-8 text-[11px]",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

export function Avatar({ photoUrl, name, size = "md", className }: AvatarProps) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={cn("rounded-full object-cover", SIZES[size], className)}
      />
    );
  }
  return (
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
}
