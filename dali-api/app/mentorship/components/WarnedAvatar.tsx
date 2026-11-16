import { Avatar, type AvatarProps } from "~/components/ui/Avatar";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

export function WarningDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Open warning"
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-destructive", className)}
    />
  );
}

export function WarnedAvatar({ warned, ...avatar }: AvatarProps & { warned: boolean }) {
  if (!warned) return <Avatar {...avatar} />;
  return (
    <Tooltip content="Open warning">
      <span className="relative inline-flex shrink-0">
        <Avatar {...avatar} />
        <WarningDot className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5" />
      </span>
    </Tooltip>
  );
}
