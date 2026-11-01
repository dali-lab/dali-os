// Initials tile for a PartnerContact — shared by the contact 360 header and
// the directory list.

const SIZES = {
  sm: "w-8 h-8 rounded-full text-xs",
  lg: "w-16 h-16 rounded-full text-xl",
} as const;

export function ContactAvatar({
  contact,
  size = "sm",
}: {
  contact: { name: string | null; email: string | null };
  size?: keyof typeof SIZES;
}) {
  const label = contact.name || contact.email || "?";
  return (
    <div
      className={`${SIZES[size]} bg-os-accent/15 text-os-accent flex items-center justify-center font-bold flex-shrink-0`}
    >
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}
