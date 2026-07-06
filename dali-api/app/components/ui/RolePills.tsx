import { cn } from "~/lib/cn";

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
const ADMIN_TONE = "bg-accent-coral/15 text-accent-coral";
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
  const sizeClass = SIZES[size];
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {isAdmin && (
        <span className={cn(PILL_BASE, ADMIN_TONE, sizeClass)}>Admin</span>
      )}
      {isCore && (
        <span className={cn(PILL_BASE, DEFAULT_TONE, sizeClass)}>Core</span>
      )}
      {coreTitles?.map((title) => (
        <span key={`core-${title}`} className={cn(PILL_BASE, DEFAULT_TONE, sizeClass)}>
          {title}
        </span>
      ))}
      {domainRoles?.map((role, i) => (
        <span
          key={`domain-${role.domainName}-${i}`}
          className={cn(PILL_BASE, DEFAULT_TONE, sizeClass)}
        >
          {showLevel && role.level
            ? `${role.domainName} · ${role.level}`
            : role.domainName}
        </span>
      ))}
    </span>
  );
}
