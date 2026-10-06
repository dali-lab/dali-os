import {
  Building2,
  Rocket,
  Target,
  Lightbulb,
  Compass,
  Map,
  Palette,
  Brush,
  Brain,
  Smartphone,
  Monitor,
  Gamepad2,
  Microscope,
  FlaskConical,
  Puzzle,
  Sprout,
  Flame,
  Star,
  Heart,
  Zap,
  BarChart3,
  TrendingUp,
  Bot,
  Satellite,
  Globe2,
  GraduationCap,
  Trophy,
  Wrench,
  Settings2,
  Package,
  BookOpen,
  Camera,
  Code2,
  Database,
  Leaf,
  Music,
  PenTool,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "~/lib/cn";

// Pipeline / contacts chip for a partner org. Always renders a lucide icon —
// never an emoji, never a fetched logo. By default the icon is picked
// deterministically from the org name so new orgs land on a consistent (but
// varied) glyph; users can override by storing `lucide:<IconName>` in the
// `char` field (same convention as Project.iconEmoji).

export type PartnerFaviconSize = "xs" | "sm" | "md";

type Props = {
  char?: string | null;
  name?: string | null;
  size?: PartnerFaviconSize;
  className?: string;
};

const SIZE_CLASS: Record<PartnerFaviconSize, string> = {
  xs: "h-6 w-6 rounded-md",
  sm: "h-8 w-8 rounded-md",
  md: "h-10 w-10 rounded-lg",
};
const GLYPH_CLASS: Record<PartnerFaviconSize, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
};

// Shared with the project icon library so the picker UX is identical. Order
// matters for determinism: a given org name always maps to the same index.
export const PARTNER_ICON_LIBRARY: Record<string, LucideIcon> = {
  Building2, Rocket, Target, Lightbulb, Compass, Map, Palette, Brush, Brain,
  Smartphone, Monitor, Gamepad2, Microscope, FlaskConical, Puzzle, Sprout,
  Flame, Star, Heart, Zap, BarChart3, TrendingUp, Bot, Satellite, Globe2,
  GraduationCap, Trophy, Wrench, Settings2, Package, BookOpen, Camera, Code2,
  Database, Leaf, Music, PenTool, Users,
};
const ICON_NAMES = Object.keys(PARTNER_ICON_LIBRARY);
const LUCIDE_PREFIX = "lucide:";

function hashIndex(seed: string, mod: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

// Picks a stable lucide icon for an org. Explicit `lucide:Name` override
// wins; otherwise the org name is hashed into the curated set so the glyph
// stays consistent across renders and routes.
function iconFor(char: string | null | undefined, name: string | null | undefined): LucideIcon {
  if (typeof char === "string" && char.startsWith(LUCIDE_PREFIX)) {
    const named = PARTNER_ICON_LIBRARY[char.slice(LUCIDE_PREFIX.length)];
    if (named) return named;
  }
  if (!name) return Building2;
  return PARTNER_ICON_LIBRARY[ICON_NAMES[hashIndex(name, ICON_NAMES.length)]];
}

export function PartnerFavicon({ char, name, size = "sm", className }: Props) {
  const Icon = iconFor(char, name);
  return (
    <span
      aria-hidden
      style={{ background: "#ffffff14", color: "#d9dadf" }}
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        SIZE_CLASS[size],
        className,
      )}
    >
      <Icon className={GLYPH_CLASS[size]} strokeWidth={1.8} />
    </span>
  );
}
