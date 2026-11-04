import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const resolvePhotoUrl = vi.hoisted(() => vi.fn());
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl }));

import { prisma } from "~/lib/db.server";
import {
  runGetProjectSettings,
  GET_PROJECT_SETTINGS_TOOL,
  ProjectSettingsNotFoundError,
} from "~/mcp/tools/project-settings";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
};

const PROJECT = {
  id: "p1",
  name: "Harbor",
  status: "Active",
  description: "A project",
  imageUrl: "s3://key",
  termCount: 3,
  repoUrls: ["https://github.com/example/harbor"],
  figmaUrls: [],
  deploymentUrl: null,
  slackChannelName: "harbor",
  slackChannelId: "C1",
  githubTeamSlug: "harbor",
  calendarEmail: null,
  teamGroupEmail: null,
  overviewPageId: "pg1",
  prdPageId: null,
  projectTerms: [
    { term: { code: "26S", sortKey: 2 } },
    { term: { code: "26W", sortKey: 1 } },
  ],
  domains: [{ domain: { id: "d1", code: "eng", displayName: "Engineering" } }],
  domainScopes: [
    { scope: "Ship v2", domain: { displayName: "Engineering" }, term: { code: "26S", sortKey: 2 } },
    { scope: "Ship v1", domain: { displayName: "Engineering" }, term: { code: "26W", sortKey: 1 } },
  ],
  showcase: { status: "Draft" },
};

beforeEach(() => {
  vi.clearAllMocks();
  resolvePhotoUrl.mockResolvedValue("https://cdn.example/photo.jpg");
});

describe("get_project_settings", () => {
  it("scope is read", () => {
    expect(GET_PROJECT_SETTINGS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws a 404 error for a missing project", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    const err = await runGetProjectSettings("u1", { projectId: "nope" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectSettingsNotFoundError);
    expect(err.status).toBe(404);
  });

  it("orders terms and scopes by term and resolves the image", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(PROJECT);
    const out = await runGetProjectSettings("u1", { projectId: "p1" });
    expect(out.terms).toEqual(["26W", "26S"]);
    expect(out.scopes).toEqual([
      { domain: "Engineering", term: "26W", scope: "Ship v1" },
      { domain: "Engineering", term: "26S", scope: "Ship v2" },
    ]);
    expect(out.domains).toEqual([{ id: "d1", code: "eng", displayName: "Engineering" }]);
    expect(out.imageUrl).toBe("https://cdn.example/photo.jpg");
    expect(resolvePhotoUrl).toHaveBeenCalledWith("s3://key");
    expect(out.showcaseStatus).toBe("Draft");
  });

  it("returns a null showcase status when there is no showcase", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ...PROJECT, showcase: null });
    expect((await runGetProjectSettings("u1", { projectId: "p1" })).showcaseStatus).toBeNull();
  });

  it("never selects or returns chart strings", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(PROJECT);
    const out = await runGetProjectSettings("u1", { projectId: "p1" });
    const select = mockPrisma.project.findUnique.mock.calls[0][0].select;
    expect(Object.keys(select).some((k) => /chart/i.test(k))).toBe(false);
    expect(Object.keys(out).some((k) => /chart/i.test(k))).toBe(false);
  });
});
