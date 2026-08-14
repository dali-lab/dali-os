import type { ApplicationCycleType } from "~/generated/prisma/client";

// Client-safe helpers shared by the internal-cycle machinery. The server-only
// registry (eligibility, accept side-effects, reviewer defaults) lives in
// internal-cycles.server.ts and re-exports these.

// "Internal" cycle types run the member-authed applicant portal + DB-backed
// shortform (no per-domain challenges) + no interviews + single reviewer pool.
export type InternalCycleType = "Fellowship" | "Core";

export const INTERNAL_CYCLE_TYPES: readonly InternalCycleType[] = ["Fellowship", "Core"];

export function isInternalCycleType(t: ApplicationCycleType): t is InternalCycleType {
  return t === "Fellowship" || t === "Core";
}

// Display labels for every cycle type. Keyed by the enum value.
export const CYCLE_TYPE_LABELS: Record<ApplicationCycleType, string> = {
  Standard: "Standard hire",
  Fellowship: "Fellowship",
  Core: "Core",
};
