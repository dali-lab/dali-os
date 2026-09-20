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

export const OFFERING_TYPE_DESCRIPTIONS: Record<OfferingType, string> = {
  Workshop: "Workshop: single-session event with RSVP-style approval. No ongoing attendance.",
  Miniseries: "Miniseries: multi-session course within one term, with reviewed applications and attendance tracking.",
  Fellowship: "Fellowship: multi-session program spanning multiple terms, with reviewed applications and attendance tracking.",
};

export const OFFERING_TYPE_TINT: Record<OfferingType, string> = {
  Workshop: "bg-accent-coral/10 text-accent-coral",
  Miniseries: "bg-accent-teal/10 text-accent-teal",
  Fellowship: "bg-accent-yellow/25 text-foreground",
};
