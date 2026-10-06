import { listMyHiringApplications, type HiringHistoryEntry } from "./applicant-history.server";
import type { DomainApplicationStatus } from "~/types";

// The "prior applications" panel on a reviewer/lead application view: the same
// applicant's other submitted cycles, so a reviewer/lead can see hiring
// history without leaving the page. Wraps listMyHiringApplications, dropping
// the application being viewed and any drafts (an unsubmitted application
// isn't history yet). When the viewer is in blind review, outcomes are nulled
// here, server-side, so a blinded payload never carries a domain's status.

export type PriorApplicationRow = Omit<HiringHistoryEntry, "domains"> & {
  domains: { id: string; domainName: string; status: DomainApplicationStatus | null }[];
};

export async function listPriorApplications(args: {
  userId: string;
  currentApplicationId: string;
  hideOutcomes: boolean;
}): Promise<PriorApplicationRow[]> {
  const { userId, currentApplicationId, hideOutcomes } = args;
  const history = await listMyHiringApplications(userId);

  return history
    .filter((entry) => entry.id !== currentApplicationId && entry.applicationStatus !== "Draft")
    .map((entry) => ({
      ...entry,
      domains: entry.domains.map((domain) => ({
        ...domain,
        status: hideOutcomes ? null : domain.status,
      })),
    }));
}
