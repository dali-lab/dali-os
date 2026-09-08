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
  {
    key: "google-meet",
    label: "Google Meet",
    description:
      "Attach a Google Meet link to meetings. In the calendar's create-event modal an 'Add Google Meet' toggle mints a Meet link on the organizer's linked Google calendar, so the invite Google sends carries a Join link. When the flag is on for everyone, online hiring interviews also get an auto-generated Meet link — created on the shared hiring calendar (that account must be linked once in the calendar settings) and folded into the existing interview emails. Ships off.",
  },
  {
    key: "drive-folder-bindings",
    label: "Drive folder bindings",
    description:
      "Replaces the hidden systemKey Drive scaffolding with editable process→folder bindings. Each project / education offering / hiring cycle / Core governance area points at NORMAL Drive folders (renameable, movable, shareable) for its auto-filed items (meeting notes, forms, agreements, …), configured in that process's settings. Ships off; without it the legacy systemKey folders remain.",
  },
  {
    key: "project-status-bar",
    label: "Project status bar",
    description:
      "A compact work-status strip above the project timeline (Progress tab): task progress, the active sprint's deadline, and attention flags (overdue, unscheduled, in review, stale). Deterministic — no AI. Ships off.",
  },
  {
    key: "project-tldr-ai",
    label: "Project AI TL;DR",
    description:
      "Adds an AI-written one-or-two-sentence summary of the project's work status beneath the status bar. Only shows when the 'Project status bar' flag is also on AND an AI provider is configured. Ships off.",
  },
  {
    key: "mentorship-manage",
    label: "Manage mentorship pairs",
    description:
      "Lets Core hand-create, reassign, and remove mentorship pairs — inline on the Notes grid (Edit pairs) and on each project's Mentorship tab. Pairs are still auto-derived at staffing finalize; manual edits are tagged and preserved across a re-finalize. Ships off.",
  },
  {
    key: "sprint-view",
    label: "Sprint view",
    description:
      "Promotes Sprint to a top-level filter on the project task board: view the current sprint, any past sprint, or the backlog in one click. Opens the board on the current sprint when one is running, and hides the term filter while a sprint is selected. Ships off; without it the board keeps the epic-nested sprint sub-filter.",
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
