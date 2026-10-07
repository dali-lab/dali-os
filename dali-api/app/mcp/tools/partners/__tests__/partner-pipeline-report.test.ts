import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ canViewStaffing: vi.fn() }));
vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpForbiddenError, McpInvalidError, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});
vi.mock("~/partners/lib/partner-reports.server", () => ({
  resolveReportsTerm: vi.fn(),
  loadFunnelSection: vi.fn(),
  loadCycleTimeSection: vi.fn(),
}));

import { canViewStaffing } from "~/lib/roles";
import {
  resolveReportsTerm,
  loadFunnelSection,
  loadCycleTimeSection,
} from "~/partners/lib/partner-reports.server";
import {
  runPartnerPipelineReport,
  PARTNER_PIPELINE_REPORT_TOOL,
} from "../partner-pipeline-report";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveReportsTerm).mockResolvedValue({
    terms: [],
    selectedTermId: "term-1",
    selectedTermCode: "27F",
  });
  vi.mocked(loadFunnelSection).mockResolvedValue({
    funnel: { stageCounts: { New: 1, Interview: 0, Accepted: 0, Rejected: 0 }, total: 1, newToInterviewRate: 0, interviewToAcceptedRate: null },
    bySource: [],
  });
  vi.mocked(loadCycleTimeSection).mockResolvedValue({
    medianToAcceptedDays: null,
    medianToProjectDays: null,
    sampleSize: { toAccepted: 0, toProject: 0 },
  });
});

describe("partner_pipeline_report", () => {
  it("requires mcp:read scope", () => {
    expect(PARTNER_PIPELINE_REPORT_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-staffing callers", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    await expect(runPartnerPipelineReport("u1", {})).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("rejects passing both termId and allTime", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    await expect(
      runPartnerPipelineReport("u1", { termId: "t1", allTime: true }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("resolves 'all' when allTime is set", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    await runPartnerPipelineReport("u1", { allTime: true });
    expect(resolveReportsTerm).toHaveBeenCalledWith("all");
  });

  it("passes termId through and returns the combined shape", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    const result = await runPartnerPipelineReport("u1", { termId: "term-1" });

    expect(resolveReportsTerm).toHaveBeenCalledWith("term-1");
    expect(loadFunnelSection).toHaveBeenCalledWith("term-1");
    expect(loadCycleTimeSection).toHaveBeenCalledWith("term-1");
    expect(result).toMatchObject({
      termId: "term-1",
      termCode: "27F",
      funnel: expect.objectContaining({ total: 1 }),
      cycleTime: expect.objectContaining({ sampleSize: { toAccepted: 0, toProject: 0 } }),
    });
  });

  it("defaults to the current term when nothing is passed", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    await runPartnerPipelineReport("u1", {});
    expect(resolveReportsTerm).toHaveBeenCalledWith(null);
  });
});
