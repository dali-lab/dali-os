import { Compass, Layers, Rocket, Trees } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import type { Achievement, AchievementKey } from "~/members/lib/achievements.server";

// Medals for the profile rail. Each milestone gets its own shape and palette
// rather than one badge in four colours — at rail width they're read as a
// group, and silhouette separates them faster than hue does.

const MEDAL: Record<
  AchievementKey,
  { Icon: typeof Rocket; ring: string; fill: string; ink: string; shape: string }
> = {
  onboarded: {
    Icon: Compass,
    ring: "ring-accent-teal/30",
    fill: "bg-accent-teal/15",
    ink: "text-accent-teal",
    // Circle — the starting badge.
    shape: "rounded-full",
  },
  "first-term": {
    Icon: Rocket,
    ring: "ring-accent-coral/30",
    fill: "bg-accent-coral/15",
    ink: "text-accent-coral",
    // Rounded square.
    shape: "rounded-xl",
  },
  "multi-domain": {
    Icon: Layers,
    ring: "ring-accent-green/30",
    fill: "bg-accent-green/15",
    ink: "text-accent-green",
    // Hexagon, via clip-path below.
    shape: "rounded-md [clip-path:polygon(25%_2%,75%_2%,100%_50%,75%_98%,25%_98%,0%_50%)]",
  },
  veteran: {
    Icon: Trees,
    ring: "ring-amber-500/30",
    fill: "bg-amber-500/15",
    ink: "text-amber-600",
    // Shield.
    shape: "rounded-t-xl [clip-path:polygon(0%_0%,100%_0%,100%_62%,50%_100%,0%_62%)]",
  },
};

export function AchievementsBlock({ achievements }: { achievements: Achievement[] }) {
  // Earned medals only — an unearned one is a list of things you haven't done,
  // which is worse to look at than nothing on your own profile and nobody
  // else's business on someone else's. The section itself always renders, so
  // the rail keeps its shape and the first medal appears in a place the member
  // has already seen.
  const earned = achievements.filter((a) => a.earned);

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Achievements</h2>

      {earned.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No achievements yet.</p>
      )}

      <ul className="grid grid-cols-4 gap-2">
        {earned.map((a) => {
          const m = MEDAL[a.key];
          const { Icon } = m;
          return (
            <li key={a.key} className="flex flex-col items-center gap-1.5">
              <Tooltip label={`${a.title} — ${a.description}`}>
                <span
                  aria-hidden
                  className={`flex h-11 w-11 items-center justify-center ring-1 ${m.shape} ${m.fill} ${m.ring}`}
                >
                  <Icon className={`h-5 w-5 ${m.ink}`} strokeWidth={2} />
                </span>
              </Tooltip>
              <span className="text-center text-[10px] font-medium leading-tight text-foreground">
                {a.title}
              </span>
              <span className="sr-only">{a.description}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
