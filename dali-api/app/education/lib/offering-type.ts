import type { OfferingType } from "~/generated/prisma/enums";

export type { OfferingType };

export const OFFERING_TYPES = ["Workshop", "Miniseries", "Fellowship"] as const satisfies readonly OfferingType[];

export function isOfferingType(value: unknown): value is OfferingType {
  return (OFFERING_TYPES as readonly unknown[]).includes(value);
}

// Miniseries and fellowships share one model: many sessions, reviewed
// applications, and a completion threshold. A fellowship just runs across
// several terms. Workshops are the single-session, RSVP-style exception.
export function isMultiSession(type: OfferingType): boolean {
  return type !== "Workshop";
}

// What each type is, without its own name in front: callers that show the
// name (the type badge, the picker's list) would otherwise repeat it.
export const OFFERING_TYPE_DESCRIPTIONS: Record<OfferingType, string> = {
  Workshop: "Single session with RSVP-style approval. No ongoing attendance.",
  Miniseries: "Several sessions inside one term, with reviewed applications and attendance.",
  Fellowship: "Several sessions across multiple terms, with reviewed applications and attendance.",
};

export const OFFERING_TYPE_TINT: Record<OfferingType, string> = {
  Workshop: "bg-accent-coral/10 text-accent-coral",
  Miniseries: "bg-accent-teal/10 text-accent-teal",
  Fellowship: "bg-accent-yellow/25 text-foreground",
};
