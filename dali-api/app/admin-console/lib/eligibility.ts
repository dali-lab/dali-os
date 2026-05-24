// Client-safe shared constants/types for DomainEligibility editing. The
// prisma writers live in eligibility.server.ts to keep them out of the
// client bundle; pure values stay here so route components can render the
// level picker without pulling a "*.server" file into the browser.

export type Level = "P1" | "P2" | "P3";

export const ALLOWED_LEVELS: Level[] = ["P1", "P2", "P3"];

export function parseLevel(raw: unknown): Level | null {
  if (typeof raw !== "string") return null;
  return (ALLOWED_LEVELS as string[]).includes(raw) ? (raw as Level) : null;
}
