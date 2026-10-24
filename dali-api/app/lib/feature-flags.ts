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
    key: "release-notes",
    label: "Release notes",
    description:
      "A /release-notes page listing what shipped, with demo videos, and a \"What's new\" item in the account menu that shows a dot when there is something unread. Core also gets Communications > Release notes to write, review and publish entries. Ships off.",
  },
  {
    key: "favorites-bar",
    label: "Favorites bar",
    description:
      "Browser-style favorites: one star in the topbar (next to Copy link, or Cmd/Ctrl+D) that stars whatever page is open, and topbar favorite pills you can drag to reorder or right-click to move and remove. Hides the breadcrumb star and the document title star. Ships off.",
  },
  {
    key: "landing-leaderboard",
    label: "Home landing high scores",
    description:
      "Keeps a high-score board for the tetris game on the week 5 (\"Build\") home landing scene: one personal best per member, listed by name, shown on the attract screen and the game-over card. Off, the game plays exactly as before and nothing is recorded. Ships on — the kill switch exists because the scores are the player's own word for them.",
    defaultEnabled: true,
    defaultEveryone: true,
  },
  {
    key: "email-layout",
    label: "Standard email layout",
    description:
      "Wraps outbound email in one branded layout instead of the four hand-rolled styles it uses today: a real HTML document with a light/dark-aware single-column 600px body, one greeting, one button style, and one footer. Also gives every email a plain-text alternative, which most currently ship without. Content is unchanged — only the frame around it. Ships off.",
  },
  {
    key: "optimal-times",
    label: "Find best meeting times",
    description:
      "Suggests the best meeting times in the scheduler. Once people are added, the top 3 slots where the most participants (with a linked calendar) are free show as numbered dotted outlines on the availability grid, with a matching button for each above Starts / Ends that fills in the time. Ships off.",
  },
  {
    key: "infra-dashboard",
    label: "Infrastructure dashboard",
    description:
      "Admin → System → Infrastructure: a cross-project console pulling Fly.io + Neon inventory and usage (no dollar cost — usage only, with links out to each provider's billing) into one place, with scale / limit / provision / cleanup actions. Reads and safe reversible actions are Core; provisioning, quotas, and destructive actions are Admin-only. Ships off.",
  },
  {
    key: "project-tldr-ai",
    label: "Project AI TL;DR",
    description:
      "Adds an AI-written one-or-two-sentence summary of the project's work status beneath the status bar. Only shows when an AI provider is configured. Ships off.",
  },
  {
    key: "education-redesign-v2",
    label: "Education redesign",
    description:
      "Project-hub-style education catalog — a grid of cover cards with a per-offering emoji, a search field, and a Miniseries/Workshop type filter — on both /education (members) and /portal/education (applicants). Also switches the applicant portal home to conditional action cards (Apply to DALI, Apply to an offering, My applications, My courses) that link to the combined /portal/applications history. The offering emoji picker and the applications page ship regardless; this flag only gates the redesigned surfaces. Ships off.",
  },
  {
    key: "community",
    label: "Community",
    description:
      "The Community sidebar area: Connect, Opportunities, Gallery and Blogs. Blogs opens /resources: a front page of member blog posts (Internal, or Public to also appear on dali.website) plus bookmark tabs, reference pages that Core/Admin create, edit and delete and every lab member reads. Ships off; without it Connect stays under Lab and the other Community pages are not reachable.",
  },
  {
    key: "ai-meeting-notes",
    label: "AI meeting notes",
    description:
      "Audio is processed by a GPU job DALI runs, then deleted within minutes of the recording ending. Only the transcript is kept, visible to whoever can see the note.",
  },
  {
    key: "email-personal",
    label: "Email: personal DALI inbox",
    description:
      "Lets a member connect their own @dali.dartmouth.edu mailbox to the Email tab, next to project and shared inboxes. Only they can read it. Connecting requires agreeing to a risk notice first, and each agreement is recorded in the audit log. Turning this off hides connected personal inboxes without deleting the sign-in. Ships off.",
  },
  {
    key: "os-feedback",
    label: "DALI OS feedback",
    description:
      "A feedback button in the bottom right corner of the shell. It opens the feature request feed at /feedback, where lab members react and comment, or starts a new request: drag to select an area of the page as a screenshot (or skip it), then write it up. Screenshots use the browser's tab sharing prompt, so the desktop app and phones post text only. Ships off.",
  },
  {
    key: "partner-email",
    label: "Partner email capture",
    description:
      "Indexes partners@ mail and shows threads on partner records. Ships off.",
  },
  {
    key: "partner-finance",
    label: "Partner finance tab",
    description:
      "Finance tab, invoices and deal terms on partner records. Ships off.",
  },
  {
    key: "application-events",
    label: "Application events",
    description:
      "Help hours, socials and info sessions on a hiring cycle. Core creates events on the cycle page, emails everyone who started an application, and takes attendance by QR self check-in or by hand. Attendance shows on application reviews as an engagement signal. Ships off.",
  },
  {
    key: "drive-home",
    label: "Drive Home",
    description:
      "Shows your upcoming meetings and recently opened documents above the space chooser at the Drive root. Ships off.",
  },
  {
    key: "forms-page-access",
    label: "Forms use page access",
    description:
      "Who can see, build, and fill a form comes from its Drive page (folder scope, named shares, general access) instead of the Core/Instructor role gate and the form's own audience setting. Share a form from the same dialog as a document. A cutover switch: only 'everyone' counts, role or user targeting is ignored. Ships off.",
  },
  {
    key: "work-history-import",
    label: "Work history import",
    description:
      "Import jobs from a resume or LinkedIn export, and store a resume on the profile. Ships off.",
  },
  {
    key: "mobile-app",
    label: "Mobile app",
    description:
      "Lets the DALI OS mobile app (iOS and Android) sign in and load your profile, timesheet, projects, calendar, meeting notes and member pass. Off, the app's data endpoints return not found for that member. Ships off.",
  },
] as const satisfies readonly FeatureFlagDef[];

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]["key"];

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
