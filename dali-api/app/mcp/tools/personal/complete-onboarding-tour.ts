// MCP `complete_onboarding_tour` — mark the caller's site tour as completed.
// Reuses the same Prisma call as api.tour.complete.ts. Self-only (the tool
// authenticates as the caller and only updates their own DALIMember row). Has
// no destructive effect on accounts that already completed the tour (updateMany
// with `tourCompletedAt: null` is a no-op for those). Requires `mcp:write`.

import { prisma } from "~/lib/db";

export const COMPLETE_ONBOARDING_TOUR_DEF = {
  name: "complete_onboarding_tour",
  description:
    "Mark the authenticated member's onboarding tour as completed. " +
    "Safe to call even if the tour is already complete — it is a no-op in that case.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runCompleteOnboardingTour(userId: string) {
  await prisma.dALIMember.updateMany({
    where: { userId, tourCompletedAt: null },
    data: { tourCompletedAt: new Date() },
  });
  return { ok: true };
}
