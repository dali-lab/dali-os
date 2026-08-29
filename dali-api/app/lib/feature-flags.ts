// Registry of feature flags. Client-safe (pure data + types): the seed
// defaults and which flags exist live here; the DB row (FeatureFlag) is
// authoritative for the operator-edited targeting once it exists, edited in
// Admin → Feature Flags. This mirrors the ScheduledJob + JOBS registry
// contract (app/jobs/registry.ts): registry seeds, row wins, rows self-heal.
//
// Server-side evaluation (resolveFeatureFlags / isFeatureEnabled) lives in
// feature-flags.server.ts. The React context + useFeatureFlag hook that read
// the resolved map on the client live in app/components/FeatureFlags.tsx.

import type { UserRoles } from "~/lib/roles";

// Role flags that a flag may target. A subset of UserRoles keys — the boolean
// authority flags that make sense as an audience (excludes isLabMember, which
// is "everyone signed in"). Must be keys of UserRoles, since evaluateFlag reads
// them off the resolved roles object. The admin action constrains writes here.
export const ROLE_TARGETS = [
  "isCore",
  "isAdmin",
  "isDomainLead",
  "isInstructor",
  "isInterviewer",
  "isStaff",
  "isAlumni",
] as const satisfies readonly (keyof UserRoles)[];

export type RoleTarget = (typeof ROLE_TARGETS)[number];

export type FlagVariant = { value: string; label: string; description: string };

export type FeatureFlagDef = {
  key: string;
  label: string;
  description: string;
  // Seed values written when the row is first created (and used as the
  // resolved value while no row exists). Omitted => off; a rolled-out flag
  // sets both so a fresh environment (dev, a preview branch, CI) matches
  // production without anyone visiting Admin → Feature Flags.
  defaultEnabled?: boolean;
  defaultEveryone?: boolean;
  // Multi-value flags: the options an operator picks between, instead of the
  // flag meaning a bare on/off. Targeting is unchanged — the flag still has to
  // be enabled and match the user — it just resolves to the chosen option
  // rather than `true`. Untargeted users fall through to the caller's own
  // default (see resolveFlagVariant), NOT to defaultVariant.
  variants?: readonly FlagVariant[];
  // Which option a targeted user gets when the row hasn't named one.
  defaultVariant?: string;
};

export const FEATURE_FLAGS = [
  {
    key: "desktop-app",
    defaultEnabled: true,
    defaultEveryone: true,
    label: "Desktop app",
    description:
      "Show the desktop-app download banner, /download surfaces, and welcome CTA.",
  },
  {
    key: "home-surface",
    defaultEnabled: true,
    defaultEveryone: true,
    label: "Home page",
    description:
      "Which page / renders for the people this flag targets. Everyone it doesn't target keeps the current home — except members on the new left navigation, who get the search-first home with it.",
    variants: [
      {
        value: "classic",
        label: "Current home",
        description: "Welcome header, favorites, forms, and the DALI General Calendar week.",
      },
      {
        value: "search",
        label: "Search-first",
        description: "DALI mark, search box, shortcut tiles, then tasks and notifications.",
      },
      {
        value: "calendar",
        label: "Calendar",
        description: "Opens the calendar (availability, scheduling, timesheet) as the landing page.",
      },
    ],
    defaultVariant: "search",
  },
  {
    key: "sidebar-redesign",
    defaultEnabled: true,
    defaultEveryone: true,
    label: "New left navigation",
    description:
      "Pinned Home / Tasks / Calendar plus a single active-area dropdown. When on, the in-page horizontal pill rows are hidden. When off, users see the current flat sidebar with in-page pills.",
  },
  {
    key: "os-redesign",
    label: "dali.os design",
    description:
      "The dark dali.os shell: sidebar with an area switcher, a top bar carrying favorites and the task bell, the recents home, and the card-grid project hub. Takes precedence over the other shell flags on the pages it covers — everything it doesn't cover keeps whatever the new left navigation gives it.",
  },
  {
    key: "wallet-checkin",
    label: "Wallet check-in",
    description:
      "Members can add a DALI membership pass to Apple/Google Wallet; an organizer scans it at a meeting to mark attendance (the inverse of QR self-check-in). Needs the pass-signing certs configured in the environment — the Add-to-Wallet buttons hide when a platform is unconfigured even with this on.",
  },
  {
    key: "nav-preload",
    defaultEnabled: true,
    defaultEveryone: true,
    label: "Preload favorites & recents",
    description:
      "After the shell finishes loading, quietly warm the pages in the sidebar's Favorites and Recent lists so opening one from the nav is instant. Skipped on data-saver and 2g connections.",
  },
  {
    key: "calendar-unified",
    label: "Calendar",
    description:
      "The full DALI calendar behind one flag: create / edit / delete events on your linked Google calendars (Google write; Outlook read-only), schedule meetings with an availability heatmap, add your Dartmouth classes (period picker → exact weekly times, synced to Google), and the optional timesheet-to-Google mirror. Ships off; without it the calendar is a read-only busy view.",
  },
] as const satisfies readonly FeatureFlagDef[];

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]["key"];

/** The three home pages a member can land on. See the "home-surface" flag. */
export type HomeSurface = "classic" | "search" | "calendar";

export function isHomeSurface(value: string | null | undefined): value is HomeSurface {
  return value === "classic" || value === "search" || value === "calendar";
}

export type FeatureFlagMap = Record<FeatureFlagKey, boolean>;

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return FEATURE_FLAGS.some((f) => f.key === value);
}

// The evaluable shape of a flag — either a DB FeatureFlag row or a registry
// default synthesized for a flag with no row yet.
export type FlagConfig = {
  enabled: boolean;
  everyone: boolean;
  roles: string[];
  userIds: string[];
  /** Multi-value flags only; null = the registry's defaultVariant. */
  variant?: string | null;
};

// A flag is on for a user iff the master switch is set AND any targeting rule
// matches: everyone, an explicit allowlist entry, or a held role. Pure (no DB)
// so it lives in the client-safe module and can be unit-tested directly.
export function evaluateFlag(
  config: FlagConfig,
  userId: string,
  roles: UserRoles,
): boolean {
  if (!config.enabled) return false;
  if (config.everyone) return true;
  if (config.userIds.includes(userId)) return true;
  return config.roles.some((k) => k in roles && roles[k as keyof UserRoles]);
}

// The option a multi-value flag resolves to for one user, or null when the
// flag doesn't target them — callers decide what "not targeted" means, since
// the sensible fallback differs per feature.
export function evaluateVariant(
  def: FeatureFlagDef,
  config: FlagConfig,
  userId: string,
  roles: UserRoles,
): string | null {
  if (!evaluateFlag(config, userId, roles)) return null;
  const chosen = config.variant ?? def.defaultVariant ?? null;
  // A row naming an option that has since left the registry shouldn't strand
  // the user on a surface that no longer exists.
  if (chosen && def.variants?.some((v) => v.value === chosen)) return chosen;
  return def.defaultVariant ?? null;
}
