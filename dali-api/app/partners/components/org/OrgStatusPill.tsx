// Partner pills, in the dali.os badge shape: one neutral pill with the state
// carried by a small colored dot. Shared by the org/contact 360 headers and
// the directory list so a status reads the same everywhere.

import type { PartnerOrgType } from "~/generated/prisma/enums";
import { cn } from "~/lib/cn";
import {
  PARTNER_ORG_TYPE_LABELS,
  PARTNER_RELATIONSHIP_STATUS_LABELS,
  type PartnerRelationshipStatus,
} from "../../lib/partner-org";
import {
  PARTNER_STAGE_LABELS,
  type PartnerStage,
} from "../../lib/partner-application";

const SIZES = {
  sm: "px-2.5 py-0.5 text-xs",
  md: "px-3 py-[5px] text-[13px] font-semibold",
} as const;

export type PillSize = keyof typeof SIZES;

export function DotPill({
  dot,
  size = "sm",
  className,
  children,
}: {
  /** Background class for the state dot; omit for a plain neutral pill. */
  dot?: string;
  size?: PillSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-os-well text-foreground",
        SIZES[size],
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />}
      {children}
    </span>
  );
}

export const PARTNER_STATUS_DOT: Record<PartnerRelationshipStatus, string> = {
  Active: "bg-os-green",
  Prospect: "bg-os-accent",
  Dormant: "bg-os-amber",
  Past: "bg-os-muted",
};

export function OrgStatusPill({
  status,
  size = "sm",
}: {
  status: PartnerRelationshipStatus;
  size?: PillSize;
}) {
  return (
    <DotPill dot={PARTNER_STATUS_DOT[status]} size={size}>
      {PARTNER_RELATIONSHIP_STATUS_LABELS[status]}
    </DotPill>
  );
}

export function OrgTypePill({
  type,
  size = "sm",
}: {
  type: PartnerOrgType | null;
  size?: PillSize;
}) {
  if (!type) return null;
  return <DotPill size={size}>{PARTNER_ORG_TYPE_LABELS[type]}</DotPill>;
}

export const PARTNER_STAGE_DOT: Record<PartnerStage, string> = {
  Backlog: "bg-os-muted",
  New: "bg-os-amber",
  Interview: "bg-os-accent",
  Deciding: "bg-os-accent",
  Accepted: "bg-os-green",
  Rejected: "bg-os-red",
};

export function PartnerStagePill({ stage, size = "sm" }: { stage: PartnerStage; size?: PillSize }) {
  return (
    <DotPill dot={PARTNER_STAGE_DOT[stage]} size={size}>
      {PARTNER_STAGE_LABELS[stage]}
    </DotPill>
  );
}
