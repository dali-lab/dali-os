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
    key: "mentorship-nudge",
    label: "Nudge mentors on Slack",
    description:
      "Adds Core-only buttons on the Mentorship notes grid to Slack-DM mentors who haven't filled in their notes — a bulk 'Message mentors who haven't filled in' button (with an editable message + recipient preview) and a per-mentor nudge. Each mentor also gets an in-app notification. The Slack DM is force-sent regardless of the mentor's notification preferences, but stays prod-gated (staging/dev report 'not sent' unless NOTIFY_SLACK_DM_OVERRIDE=1). Ships off.",
  },
  {
    key: "mentee-countersign",
    label: "Mentee countersignatures",
    description:
      "Turns mentorship agreements into co-signed documents: once a mentor signs the term's agreement, each of their mentees is required to countersign the same document (they see the mentor's completed copy and add their own signature). Mentees are hard-gated until they countersign, exactly like mentors, and get a 'please countersign' notification when a mentor signs. Only documents with 'Require mentee countersignature' turned on are affected. All-or-nothing (targeting a subset of users would gate some mentees while their mentors are gated for everyone). Ships off.",
  },
  {
    key: "education-redesign-v2",
    label: "Education redesign",
    description:
      "Project-hub-style education catalog — a grid of cover cards with a per-offering emoji, a search field, and a Miniseries/Workshop type filter — on both /education (members) and /portal/education (applicants). Also switches the applicant portal home to conditional action cards (Apply to DALI, Apply to an offering, My applications, My courses) that link to the combined /portal/applications history. The offering emoji picker and the applications page ship regardless; this flag only gates the redesigned surfaces. Ships off.",
  },
  {
    key: "resources",
    label: "Resources page",
    description:
      "A lab-wide Resources document at /resources: one shared collaborative page with no document chrome, read by every lab member and edited by Core/Admin behind an Edit button. Takes the pinned sidebar slot under Calendar, which moves Drive down into General. Ships off; without it the slot stays Drive and /resources is not reachable.",
  },
  {
    key: "room-booking",
    label: "Room booking",
    description:
      "Book DALI rooms from the web (Room booking, pinned under Resources), put a room on a meeting or event, and manage rooms and their door displays (Core ▸ Rooms). The iPad door displays authenticate with their own token and don't read this flag. Ships off.",
  },
  {
    key: "ai-meeting-notes",
    label: "AI meeting notes",
    description:
      "A Record button on meeting-note documents, in the browser or the desktop app. Recording always runs in the DALI OS macOS app: it captures system audio (everyone on a call, macOS 14.2+) and the mic, transcribes on-device with Apple's speech recognition, and streams the transcript to the page. On stop, Claude turns it into a summary, decisions, and action items appended to the note with the full transcript. No audio is uploaded or stored. Needs a desktop release newer than 0.1.6. Without an AI provider it adds the transcript only. Ships off.",
  },
  {
    key: "my-project-work",
    label: "Project work in My Tasks",
    description:
      "Adds a Project work tab to the notification drawer and My Tasks page: the open project tasks you're assigned to (To do, In progress, In review), flagged when overdue or stale, with Open task and Mark done. They also count toward the bell badge. Meetings, invites and other notifications move to a Meetings & events tab. Ships off.",
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
