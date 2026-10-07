// Type + relationship-status pills for a PartnerOrg — shared by the org 360
// header and the directory list/cards.

import type { PartnerOrgType } from "~/generated/prisma/enums";
import {
  PARTNER_ORG_TYPE_LABELS,
  PARTNER_RELATIONSHIP_STATUS_LABELS,
  PARTNER_RELATIONSHIP_STATUS_PILL,
  type PartnerRelationshipStatus,
} from "../../lib/partner-org";

export function OrgStatusPill({ status }: { status: PartnerRelationshipStatus }) {
  return (
    <span
      className={`text-xs rounded-full px-2 py-0.5 ${PARTNER_RELATIONSHIP_STATUS_PILL[status]}`}
    >
      {PARTNER_RELATIONSHIP_STATUS_LABELS[status]}
    </span>
  );
}

export function OrgTypePill({ type }: { type: PartnerOrgType | null }) {
  if (!type) return null;
  return (
    <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5">
      {PARTNER_ORG_TYPE_LABELS[type]}
    </span>
  );
}
