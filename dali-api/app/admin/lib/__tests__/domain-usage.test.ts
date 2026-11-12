import { describe, it, expect } from "vitest";
import { describeDomainUsage } from "~/admin/lib/domain-usage";

const ZERO_COUNTS = {
  applicationCycles: 0,
  domainLeadAssignments: 0,
  cycleReviewers: 0,
  cycleInterviewers: 0,
  delibsSessions: 0,
  eligibilities: 0,
  projectAssignments: 0,
  projects: 0,
  projectScopes: 0,
  projectRoleRequests: 0,
  partnerApplicationDomains: 0,
  tasks: 0,
  mentorshipPairs: 0,
};

describe("describeDomainUsage", () => {
  it("returns empty list when nothing references the domain", () => {
    expect(describeDomainUsage(ZERO_COUNTS)).toEqual([]);
  });

  it("describes only non-zero relations", () => {
    const out = describeDomainUsage({
      ...ZERO_COUNTS,
      applicationCycles: 2,
      cycleReviewers: 3,
    });
    expect(out).toEqual(["2 application cycles", "3 cycle reviewers"]);
  });

  it("flags post-Phase-2 relations (eligibilities, projects, etc.)", () => {
    const out = describeDomainUsage({
      ...ZERO_COUNTS,
      eligibilities: 4,
      projectAssignments: 2,
      partnerApplicationDomains: 1,
    });
    expect(out).toEqual([
      "4 member eligibilities",
      "2 project assignments",
      "1 partner applications",
    ]);
  });
});
