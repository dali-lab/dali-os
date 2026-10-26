import {
  Briefcase,
  Folder,
  FolderKanban,
  GraduationCap,
  Heart,
  Shield,
  Star,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { AreaTile } from "~/components/shell/AreaTile";
import { DRIVE_SPACE_AREA, FAVORITES_SPACE_KEY, SHARED_SPACE_KEY } from "~/lib/drive-spaces";

export type ScopeIconSize = "sm" | "lg" | "xl";

type ScopeLike = { id: string; iconEmoji?: string | null };

const TILE_SIZE = { sm: 20, lg: 32, xl: 40 } as const;

const MUTED = "text-muted-foreground";
const CORAL = "text-accent-coral/80";

const SCOPE_GLYPHS = {
  mine: [User, MUTED],
  [FAVORITES_SPACE_KEY]: [Star, MUTED],
  [SHARED_SPACE_KEY]: [UserPlus, MUTED],
  lab: [Users, MUTED],
  core: [Shield, CORAL],
  hiring: [Briefcase, CORAL],
  mentorship: [Heart, CORAL],
  projects: [FolderKanban, CORAL],
  education: [GraduationCap, CORAL],
} as const;

export function scopeIconFor(scope: ScopeLike, size: ScopeIconSize = "sm", tiles = false) {
  const areaKey = DRIVE_SPACE_AREA[scope.id];
  if (tiles && areaKey) return <AreaTile areaKey={areaKey} size={TILE_SIZE[size]} />;
  const cls = `${size === "xl" ? "w-10 h-10" : size === "lg" ? "w-8 h-8" : "w-4 h-4"} shrink-0`;
  const glyph = (SCOPE_GLYPHS as Record<string, readonly [typeof Folder, string]>)[scope.id];
  if (glyph) {
    const [Icon, tone] = glyph;
    return <Icon className={`${cls} ${tone}`} aria-hidden />;
  }
  if (scope.iconEmoji) {
    const emojiCls = `leading-none shrink-0 ${
      size === "xl" ? "text-3xl" : size === "lg" ? "text-2xl" : "text-base"
    }`;
    return (
      <span className={emojiCls} aria-hidden>
        {scope.iconEmoji}
      </span>
    );
  }
  return <Folder className={`${cls} ${CORAL}`} aria-hidden />;
}

export function DriveScopeIcon({
  scope,
  size = "sm",
  tiles = false,
}: {
  scope: ScopeLike;
  size?: ScopeIconSize;
  tiles?: boolean;
}) {
  return scopeIconFor(scope, size, tiles);
}
