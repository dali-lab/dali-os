import {
  FolderKanban,
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
  Building2,
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
  Link as LinkIcon,
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

// Curated set of lucide icons offered to projects. Stored in the string
// `iconEmoji` column as `lucide:Name` so the migration-free switch stays
// backward compatible with existing emoji values.
export const LUCIDE_ICON_LIBRARY: Record<string, LucideIcon> = {
  Rocket, Target, Lightbulb, Compass, Map, Palette, Brush, Brain,
  Smartphone, Monitor, Gamepad2, Microscope, FlaskConical, Puzzle, Building2, Sprout,
  Flame, Star, Heart, Zap, BarChart3, TrendingUp, Bot, Satellite,
  Globe2, GraduationCap, Trophy, Wrench, Settings2, Package, Link: LinkIcon,
  BookOpen, Camera, Code2, Database, Leaf, Music, PenTool, Users,
};

export const LUCIDE_PREFIX = "lucide:";

export function isLucideIcon(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(LUCIDE_PREFIX);
}

export function parseLucideName(value: string): LucideIcon | null {
  const name = value.slice(LUCIDE_PREFIX.length);
  return LUCIDE_ICON_LIBRARY[name] ?? null;
}

/**
 * Leading icon for a project. Supports two stored formats in `iconEmoji`:
 *   • `lucide:Name` — renders the corresponding lucide SVG.
 *   • any other string — rendered as-is (emoji compatibility).
 * Null/empty falls back to a neutral project glyph.
 */
const SLOT = {
  sm: { box: "w-4", emoji: "text-sm", glyph: "h-3.5 w-3.5" },
  lg: { box: "w-8", emoji: "text-2xl", glyph: "h-6 w-6" },
  inherit: { box: "w-[1.1em]", emoji: "text-[1em]", glyph: "h-[0.9em] w-[0.9em]" },
} as const;

export function ProjectIcon({
  iconEmoji,
  size = "sm",
  className,
}: {
  iconEmoji?: string | null;
  size?: keyof typeof SLOT;
  className?: string;
}) {
  const slot = SLOT[size];
  const classes = `flex flex-shrink-0 items-center justify-center leading-none ${slot.box}${className ? ` ${className}` : ""}`;

  const Icon = isLucideIcon(iconEmoji) ? parseLucideName(iconEmoji) : null;
  return (
    <span className={classes} aria-hidden>
      {Icon ? (
        <Icon className={slot.glyph} strokeWidth={1.8} />
      ) : (
        <FolderKanban className={`text-muted-foreground ${slot.glyph}`} />
      )}
    </span>
  );
}
