// Client-safe shared constants/types for DomainEligibility editing. The
// prisma writers live in eligibility.server.ts to keep them out of the
// client bundle; pure values stay here so route components can render the
// level picker without pulling a "*.server" file into the browser.

import { ALL_LEVELS, isLevel, type Level } from "~/lib/level";

export { type Level };
export const ALLOWED_LEVELS = ALL_LEVELS;

export function parseLevel(raw: unknown): Level | null {
  return isLevel(raw) ? raw : null;
}
