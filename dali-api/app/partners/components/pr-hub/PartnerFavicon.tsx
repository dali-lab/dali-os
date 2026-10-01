import { cn } from "~/lib/cn";

// Small square tile that stands in for an org on the Partner Relations hub.
// Mirrors Avatar's three sizes but renders a glyph (an emoji or the first
// letter of the name) on an accent-tinted square — orgs don't always carry
// a logo, and when they do, the hub still wants a consistent compact chip.

export type PartnerFaviconSize = "xs" | "sm" | "md";

type Props = {
  char?: string | null;
  name?: string | null;
  size?: PartnerFaviconSize;
  className?: string;
};

const SIZE_CLASS: Record<PartnerFaviconSize, string> = {
  xs: "h-6 w-6 rounded-md text-[11px]",
  sm: "h-8 w-8 rounded-md text-[13px]",
  md: "h-10 w-10 rounded-lg text-base",
};

export function PartnerFavicon({ char, name, size = "sm", className }: Props) {
  const glyph = (char && char.trim()) || (name ? name.trim().slice(0, 1).toUpperCase() : "?");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center shrink-0 bg-os-container text-foreground font-semibold leading-none",
        SIZE_CLASS[size],
        className,
      )}
    >
      {glyph}
    </span>
  );
}
