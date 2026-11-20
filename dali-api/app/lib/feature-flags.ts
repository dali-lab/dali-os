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
// authority flags that make sense as an audience (excludes isLabMemberOrAlum, which
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
    key: "infra-dashboard",
    label: "Infrastructure dashboard",
    description:
      "Admin → System → Infrastructure: a cross-project console pulling Fly.io + Neon inventory and usage (no dollar cost — usage only, with links out to each provider's billing) into one place, with scale / limit / provision / cleanup actions. Reads and safe reversible actions are Core; provisioning, quotas, and destructive actions are Admin-only. Ships off.",
  },
  {
    key: "resource-hub",
    label: "Resource Hub",
    description:
      "A Resource Hub entry beside Calendar, Email and Drive: freely created hub pages, each a blank canvas its owners lay out with the editor's / blocks. Every lab member can read published hubs. Ships off.",
  },
  {
    key: "email-personal",
    label: "Email: personal DALI inbox",
    description:
      "Lets a member connect their own @dali.dartmouth.edu mailbox to the Email tab, next to project and shared inboxes. Only they can read it. Connecting requires agreeing to a risk notice first, and each agreement is recorded in the audit log. Turning this off hides connected personal inboxes without deleting the sign-in. Ships off.",
  },
  {
    key: "drive-slides",
    label: "Drive slide decks",
    description:
      "Adds Slides to the Drive New menus: a deck of title, text, text and image, and image slides, edited in the app and presented full screen. Decks already made keep opening when this is off. Ships off.",
  },
  {
    key: "onboarding-journeys",
    label: "Onboarding journeys",
    description:
      "Self-paced onboarding at /journeys: per-domain journeys of modules on a prerequisite map, each with lesson pages, slides, an in-browser coding lab and a quiz, with progress saved per member. First-term members find Journeys pinned under Drive; everyone else finds it in the Lab area. Core and domain leads create journeys and share edit access per journey. Ships off.",
  },
  {
    key: "refer-a-partner",
    label: "Refer a partner",
    description:
      "The Refer a partner page at /refer, where members and alumni pass along leads for project partners after a short quiz, and its Lab sidebar item. Turning this off hides the page and the sidebar item; referrals already sent stay in Core > Partners > Referrals. Ships on.",
    defaultEnabled: true,
    defaultEveryone: true,
  },
  {
    key: "website-meeting-requests",
    label: "Website meeting requests",
    description:
      "Every request from the website's support plan finder (dali.dartmouth.edu/support-plans): dali.website calls api/public/partner-meeting-requests and DALI OS emails partners@dali.dartmouth.edu with the details, with requests to meet marked in the subject. Turning this off makes that endpoint return 404; the website still files the request to its form. Only the whole-lab setting counts. Ships on.",
    defaultEnabled: true,
    defaultEveryone: true,
  },
  {
    key: "ask-dali",
    label: "Ask DALI",
    description:
      "Ask a question in plain language and get a short answer that cites the docs, meetings and tasks it came from, drawn only from what the member can already open. Read-only. Ships off.",
  },
  {
    key: "slides-collab",
    label: "Slides: live editing",
    description:
      "Slide decks open as live shared documents. Turning this on moves a deck to live editing the first time someone opens it, and new decks start live. A deck that has moved stays live if this is turned off. Ships off.",
  },
  {
    key: "slides-live",
    label: "Slides: live presenting",
    description:
      "Present a deck with a presenter view, and let anyone with the deck open follow along on their own screen, with a way to browse on their own. Also polls and emoji reactions while presenting. Ships off.",
  },
  {
    key: "project-band-header",
    label: "Project band header",
    description:
      "Project pages show a band header: the emoji, title, partner and terms, roles and team on the left and the cover image on the right. Off keeps the current header. Ships off.",
  },
  {
    key: "expenses",
    label: "Expenses",
    description:
      "An Expenses page under Lab where members drop receipts and track what they spent on staff cards or their own, staff and card owners approve, and card statements match to receipts. Ships off.",
  },
  {
    key: "mcp-email",
    label: "Email over MCP",
    description:
      "AI assistants connected to DALI OS can search the project and shared inboxes a member can open in Email, read threads, apply labels, comment, and save drafts for the member to send. Personal inboxes are never included. Ships off.",
  },
  {
    key: "paperwork",
    label: "Paperwork",
    description:
      "A Paperwork page under Lab that gathers a member's occasional lab tasks: sent-back expenses and documents to sign, this term's staffing forms, classes and applications, expenses and partner referrals, and one-time setup. Replaces the separate Expenses and Refer a partner items in Lab. Ships off.",
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
