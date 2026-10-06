// Logo tile (or initials fallback) for a PartnerOrg — shared by the org 360
// header and the directory list/cards so a logo change renders identically
// everywhere.

const SIZES = {
  sm: "w-8 h-8 rounded text-xs",
  lg: "w-12 h-12 rounded-lg text-lg",
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
        className={`${dims} object-contain bg-background border border-border flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${dims} bg-brand-tint text-dark-blue flex items-center justify-center font-bold flex-shrink-0`}
    >
      {org.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
