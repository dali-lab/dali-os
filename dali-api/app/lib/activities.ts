// Client-safe core of the Activities layer (specs/activities.md). Holds the
// mechanic list, per-kind config types, and the pure predicates shared by the
// server resolver and the client. Server-side resolution/actions live in
// activities.server.ts; the client provider/hook live in
// app/components/activities/. Mechanic behavior lives in app/activities/
// mechanics/ (a client registry and a mirrored .server registry).
//
// `kind` is a plain string validated against ACTIVITY_KINDS below — NOT a DB
// enum — so a new mechanic is a code module with zero migration.

import type { ActivityStatus } from "~/generated/prisma/client";
import type { UserRoles } from "~/lib/roles";

/** The one feature flag that gates the whole subsystem during rollout. */
export const ACTIVITIES_FLAG = "activities";

// Registry of mechanics (metadata only — the actual behavior is in the
// client/server mechanic registries). Adding an entry here + the two mechanic
// modules is all it takes; the schema never changes.
export const ACTIVITY_KINDS = [
  {
    kind: "scavenger_hunt",
    label: "Scavenger hunt",
    description:
      "Members find codes hidden across the site (clued by a Drive doc), submit them in the activity modal, and climb a leaderboard.",
  },
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]["kind"];

export function isActivityKind(k: string): k is ActivityKind {
  return ACTIVITY_KINDS.some((m) => m.kind === k);
}

export function activityKindLabel(k: string): string {
  return ACTIVITY_KINDS.find((m) => m.kind === k)?.label ?? k;
}

// ─── Per-kind config types ───────────────────────────────────────────────────
// Stored (as JSON) in Activity.config, validated by the mechanic's zod schema.

export type HuntCode = {
  id: string;
  value: string; // what the member types
  label: string; // shown when found / clue name
  location: string; // route the code element renders on, e.g. "/projects"
  points: number;
};

export type HuntLeaderboard = "public" | "core" | "off";

export type HuntConfig = {
  codes: HuntCode[];
  leaderboard: HuntLeaderboard;
  instructionsUrl?: string; // informal link to the Drive clue doc, if any
};

// ─── Active-window predicate (mirrors education's isRegistrationOpen) ─────────

type WindowRow = {
  status: ActivityStatus;
  startsAt: Date | string;
  endsAt: Date | string;
};

/** Live right now: Published AND now within [startsAt, endsAt]. */
export function isActivityActive(a: WindowRow, now: Date): boolean {
  if (a.status !== "Published") return false;
  const t = now.getTime();
  return new Date(a.startsAt).getTime() <= t && t <= new Date(a.endsAt).getTime();
}

export type ActivityPhase = "upcoming" | "active" | "ended";

export function activityPhase(a: WindowRow, now: Date): ActivityPhase {
  const t = now.getTime();
  if (t < new Date(a.startsAt).getTime()) return "upcoming";
  if (t > new Date(a.endsAt).getTime()) return "ended";
  return "active";
}

// ─── Audience role match (pure) ──────────────────────────────────────────────
// The everyone/role half of audience matching. The group + explicit-participant
// halves need the DB, so the server (activities.server.ts) does the full check.

export function matchesAudienceRoles(
  audienceRoles: string[],
  roles: UserRoles,
): boolean {
  return audienceRoles.some((r) => r in roles && roles[r as keyof UserRoles]);
}

// ─── The lightweight shape plumbed to the client via the provider ────────────
// One entry per activity live for THIS user right now. `overlay` is the
// mechanic's route-filtered, safe-to-send payload for the current path (null
// when the mechanic renders nothing on this route), computed server-side so the
// answers for other routes never reach the client.

export type ActiveActivity = {
  id: string;
  kind: ActivityKind;
  name: string;
  endsAt: string; // ISO
  overlay: unknown;
  // Short "at a glance" label for the shell bar, e.g. "3/8 found". Computed by
  // the mechanic (bannerSummary) from the member's own events; null when the
  // mechanic has nothing to summarize (e.g. a theme).
  progressLabel: string | null;
};
