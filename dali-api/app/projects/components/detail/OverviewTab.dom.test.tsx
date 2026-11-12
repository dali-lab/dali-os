// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("./DetailsSegments", () => ({ DescriptionSegment: () => null, DetailsSegment: () => null }));
vi.mock("./TeamSection", () => ({ PrincipalInvestigatorsSection: () => null, TeamSection: () => null }));
vi.mock("./MeetingsSection", () => ({ MeetingsSection: () => null }));
vi.mock("./PartnersSection", () => ({ PartnersSection: () => null }));
vi.mock("~/projects/components/ChartStringPanel", () => ({ ChartStringPanel: () => null }));
vi.mock("~/projects/components/ProjectInfraSection", () => ({ ProjectInfraSection: () => null }));
vi.mock("~/hooks/useUserTimeZone", () => ({ useUserTimeZone: () => "UTC" }));

import { renderDom } from "~/test-utils/render";
import { OverviewTab } from "./OverviewTab";

const baseProps = {
  planning: null,
  project: { id: "p1", name: "Atlas", partners: [], domains: [], derivedDomains: [], status: "Active" },
  teams: [],
  upcomingMeetings: [],
  recentActivity: [
    { id: "a1", action: "projectFile.create", actorName: "Ada Lovelace", createdAt: new Date().toISOString() },
  ],
  canEditFinance: false,
  canEditAssignmentLevel: false,
  canManagePartners: false,
  hasActivePartner: false,
  linkablePartnerOrgs: [],
  domainScopeGrid: [],
  plannedTerms: [],
  pisByTerm: {},
  coreMembers: [],
  currentTerm: null,
  chartStrings: [],
  allTermOptions: [],
  infra: {},
} as unknown as Omit<Parameters<typeof OverviewTab>[0], "canEdit">;

describe("OverviewTab", () => {
  it("shows recent activity to editors", () => {
    const { container } = renderDom(<OverviewTab {...baseProps} canEdit />);
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("added a file");
  });

  it("hides recent activity from non-editors", () => {
    const { container } = renderDom(<OverviewTab {...baseProps} canEdit={false} />);
    expect(container.textContent).not.toContain("Ada Lovelace");
  });
});
