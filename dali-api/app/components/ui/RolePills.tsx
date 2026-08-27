import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { Tooltip } from "~/components/ui/floating";

export type RolePillSize = "sm" | "md";

export interface RolePillsProps {
  isAdmin?: boolean;
  isCore?: boolean;
  coreTitles?: string[];
  domainRoles?: Array<{ domainName: string; level?: string }>;
  size?: RolePillSize;
  showLevel?: boolean;
  className?: string;
}

const SIZES: Record<RolePillSize, string> = {
  sm: "text-[11px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
};

const PILL_BASE = "inline-flex items-center rounded-full font-medium";
// Admin is the one role the brand shell singles out in coral. The os palette
// has no coral in its chrome, so it marks the same distinction with the
// accent — the pill still stands apart from the neutral ones beside it.
const ADMIN_TONE = "bg-accent-coral/15 text-accent-coral";
const OS_ADMIN_TONE = "bg-os-accent/15 text-os-accent";
const DEFAULT_TONE = "bg-muted text-foreground";

export function RolePills({
  isAdmin,
  isCore,
  coreTitles,
  domainRoles,
  size = "md",
  showLevel = false,
  className,
}: RolePillsProps) {
  const os = useFeatureFlag("os-redesign");
  const adminTone = os ? OS_ADMIN_TONE : ADMIN_TONE;
  const sizeClass = SIZES[size];
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {isAdmin && (
        <Tooltip
          content="Full system access — can manage all settings, members, and data."
          variant="rich"
        >
          <span className={cn(PILL_BASE, adminTone, sizeClass)}>Admin</span>
        </Tooltip>
      )}
      {isCore && (
        <Tooltip
          content="Core team member — broad lab access including hiring, staffing, and internal tools."
          variant="rich"
        >
          <span className={cn(PILL_BASE, DEFAULT_TONE, sizeClass)}>Core</span>
        </Tooltip>
      )}
      {coreTitles?.map((title) => (
        <Tooltip key={`core-${title}`} content={`Core role: ${title}`} variant="rich">
          <span className={cn(PILL_BASE, DEFAULT_TONE, sizeClass)}>
            {title}
          </span>
        </Tooltip>
      ))}
      {domainRoles?.map((role, i) => (
        <Tooltip
          key={`domain-${role.domainName}-${i}`}
          content={
            role.level
              ? `Domain Lead for ${role.domainName} (Level ${role.level})`
              : `Domain Lead for ${role.domainName}`
          }
          variant="rich"
        >
          <span className={cn(PILL_BASE, DEFAULT_TONE, sizeClass)}>
            {showLevel && role.level
              ? `${role.domainName} · ${role.level}`
              : role.domainName}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
