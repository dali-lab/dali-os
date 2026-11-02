// Logo tile (or initials fallback) for a PartnerOrg — shared by the org 360
// header and the directory list so a logo change renders identically
// everywhere.

import { orgInitials } from "../../lib/partner-directory";

const SIZES = {
  sm: "w-8 h-8 rounded-lg text-[11px]",
  lg: "w-16 h-16 rounded-2xl text-lg",
} as const;

export function OrgAvatar({
  org,
  size = "sm",
}: {
  org: { name: string; logoDisplayUrl?: string | null; logoUrl?: string | null };
  size?: keyof typeof SIZES;
}) {
  const src = org.logoDisplayUrl ?? org.logoUrl ?? null;
  const dims = SIZES[size];
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${dims} object-contain bg-os-well border border-os-container flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${dims} bg-os-well text-os-grey flex items-center justify-center font-semibold flex-shrink-0`}
    >
      {orgInitials(org.name)}
    </div>
  );
}
