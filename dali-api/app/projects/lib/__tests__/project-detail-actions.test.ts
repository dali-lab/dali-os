import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    project: { update: vi.fn() },
    projectPartner: { findFirst: vi.fn() },
    projectDomain: { deleteMany: vi.fn(), createMany: vi.fn() },
    projectDomainScope: { upsert: vi.fn(), deleteMany: vi.fn() },
    domain: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/groups.server", () => ({ ensureProjectGroup: vi.fn() }));
vi.mock("~/lib/infra/config-save.server", () => ({ saveInfraConfig: vi.fn() }));
vi.mock("~/lib/chart-string.server", () => ({
  recordProjectChartString: vi.fn(),
  ChartStringValidationError: class extends Error {},
  PROJECT_FUNDING_TYPES: ["Grant", "Gift"],
}));
vi.mock("~/partners/lib/partner-access", () => ({
  linkProjectPartner: vi.fn(),
  unlinkProjectPartner: vi.fn(),
  updateProjectPartnerDates: vi.fn(),
}));
vi.mock("~/partners/lib/partner-renewals.server", () => ({ setTermPi: vi.fn() }));
vi.mock("../project-terms.server", () => ({ replaceProjectTerms: vi.fn() }));

import { prisma as realPrisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { ensureProjectGroup } from "~/lib/groups.server";
import { setTermPi } from "~/partners/lib/partner-renewals.server";
import { linkProjectPartner } from "~/partners/lib/partner-access";
import { replaceProjectTerms } from "../project-terms.server";
import { runProjectDetailAction } from "../project-detail-actions.server";

const prisma = realPrisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

function run(fields: Record<string, string | string[]>, core: boolean) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) form.append(k, item);
  }
  return runProjectDetailAction({
    request: new Request("https://dali.test/projects/p1", { method: "POST" }),
    projectId: "p1",
    userId: "u1",
    core,
    form,
  });
}

const updateData = () => prisma.project.update.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockResolvedValue([]);
});

describe("project detail action dispatch", () => {
  it.each(["scopesBulk", "domains", "terms", "visibility", "status", "recordingPolicy", "chart-string"])(
    "refuses %s for non-Core",
    async (intent) => {
      expect(await run({ intent }, false)).toEqual({
        error: "Only Core or Admin can change project settings.",
      });
      expect(prisma.project.update).not.toHaveBeenCalled();
    },
  );

  it("treats an unknown intent as the details form", async () => {
    const res = await run({ intent: "constructor", calendarEmail: "x@example.edu" }, false);
    expect(res).toBeInstanceOf(Response);
    expect(updateData()).toMatchObject({ calendarEmail: "x@example.edu" });
  });

  it("treats a missing intent as the details form", async () => {
    await run({ termCount: "3" }, false);
    expect(updateData()).toMatchObject({ termCount: 3 });
  });
});

describe("pi", () => {
  it("refuses non-Core", async () => {
    expect(await run({ intent: "pi", termId: "t1" }, false)).toEqual({
      error: "Only Core can set the project PI.",
    });
  });

  it("requires a term", async () => {
    expect(await run({ intent: "pi" }, true)).toEqual({ error: "Missing term." });
  });

  it("requires the PI to be a Core member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect(await run({ intent: "pi", termId: "t1", piUserId: "u2" }, true)).toEqual({
      error: "A PI must be a Core member.",
    });
    expect(setTermPi).not.toHaveBeenCalled();
  });

  it("writes the PI and redirects for Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(setTermPi).mockResolvedValue(true as never);
    const res = await run({ intent: "pi", termId: "t1", piUserId: "u2" }, true);
    expect(setTermPi).toHaveBeenCalledWith(prisma, { projectId: "p1", termId: "t1", piUserId: "u2" });
    expect((res as Response).status).toBe(302);
  });

  it("reports a term the project is not active in", async () => {
    vi.mocked(setTermPi).mockResolvedValue(false as never);
    expect(await run({ intent: "pi", termId: "t1" }, true)).toEqual({
      error: "That project is not active in that term.",
    });
  });
});

describe("partner intents", () => {
  it("refuse non-Core", async () => {
    expect(await run({ intent: "partner-link", partnerOrgId: "o1" }, false)).toEqual({
      error: "Only Core or Admin can manage partner organizations.",
    });
    expect(linkProjectPartner).not.toHaveBeenCalled();
  });

  it("partner-link needs an organization", async () => {
    expect(await run({ intent: "partner-link" }, true)).toEqual({ error: "Select an organization." });
  });

  it("partner-end reports a missing partnership", async () => {
    prisma.projectPartner.findFirst.mockResolvedValue(null);
    expect(await run({ intent: "partner-end", projectPartnerId: "pp1" }, true)).toEqual({
      error: "Partnership not found.",
    });
  });
});

describe("chart-string", () => {
  it("requires a chart string and a term", async () => {
    expect(await run({ intent: "chart-string" }, true)).toEqual({ error: "Chart string is required." });
    expect(await run({ intent: "chart-string", chartString: "1-2-3" }, true)).toEqual({
      error: "Pick a term.",
    });
  });
});

describe("header", () => {
  it("requires a name and a valid status", async () => {
    expect(await run({ intent: "header", name: " ", status: "Active" }, false)).toEqual({
      error: "Project name is required.",
    });
    expect(await run({ intent: "header", name: "Atlas", status: "Gone" }, false)).toEqual({
      error: "Invalid status.",
    });
  });

  it("saves name, status and icon for Core, and syncs the project group", async () => {
    await run({ intent: "header", name: " Atlas ", status: "Paused", iconEmoji: "" }, true);
    expect(updateData()).toEqual({ name: "Atlas", status: "Paused", iconEmoji: null });
    expect(ensureProjectGroup).toHaveBeenCalledWith("p1", "Atlas");
  });

  it("ignores status from a non-Core member but still renames", async () => {
    expect(await run({ intent: "header", name: "Atlas", status: "Archived", iconEmoji: "x" }, false)).toBeInstanceOf(
      Response,
    );
    expect(updateData()).toEqual({ name: "Atlas", iconEmoji: "x" });
    expect(ensureProjectGroup).toHaveBeenCalledWith("p1", "Atlas");
  });

  it("replaces terms and domains only for Core and only when flagged", async () => {
    prisma.domain.findMany.mockResolvedValue([{ id: "d1" }] as never);
    await run({ intent: "header", name: "A", status: "Active", termId: ["t1"], domainId: ["d1"] }, true);
    expect(replaceProjectTerms).not.toHaveBeenCalled();
    expect(prisma.projectDomain.deleteMany).not.toHaveBeenCalled();

    await run(
      { intent: "header", name: "A", status: "Active", hasTerms: "1", hasDomains: "1", termId: ["t1"], domainId: ["d1"] },
      false,
    );
    expect(replaceProjectTerms).not.toHaveBeenCalled();

    await run(
      { intent: "header", name: "A", status: "Active", hasTerms: "1", hasDomains: "1", termId: ["t1"], domainId: ["d1"] },
      true,
    );
    expect(replaceProjectTerms).toHaveBeenCalledWith("p1", ["t1"]);
    expect(prisma.projectDomain.createMany).toHaveBeenCalled();
  });
});

describe("single-field intents", () => {
  it("description trims and nulls blank", async () => {
    await run({ intent: "description", description: "  Hi  " }, false);
    expect(updateData()).toEqual({ description: "Hi" });
    prisma.project.update.mockClear();
    await run({ intent: "description", description: "  " }, false);
    expect(updateData()).toEqual({ description: null });
  });

  it("update-image trims and nulls blank", async () => {
    await run({ intent: "update-image", imageUrl: "" }, false);
    expect(updateData()).toEqual({ imageUrl: null });
  });

  it("status rejects values outside the list and saves valid ones for Core", async () => {
    expect(await run({ intent: "status", status: "Deleted" }, true)).toEqual({ error: "Invalid status." });
    await run({ intent: "status", status: "Archived" }, true);
    expect(updateData()).toEqual({ status: "Archived" });
  });

  it("visibility treats an absent checkbox as public", async () => {
    await run({ intent: "visibility" }, true);
    expect(updateData()).toEqual({ isPrivate: false });
    prisma.project.update.mockClear();
    await run({ intent: "visibility", isPrivate: "on" }, true);
    expect(updateData()).toEqual({ isPrivate: true });
  });

  it("recordingPolicy treats an absent toggle as Disabled", async () => {
    await run({ intent: "recordingPolicy" }, true);
    expect(updateData()).toEqual({ recordingPolicy: "Disabled" });
    prisma.project.update.mockClear();
    await run({ intent: "recordingPolicy", recordingAllowed: "on" }, true);
    expect(updateData()).toEqual({ recordingPolicy: "Allowed" });
  });
});

describe("scopesBulk, domains, terms", () => {
  it("scopesBulk upserts filled cells, deletes blank ones and skips malformed keys", async () => {
    prisma.projectDomainScope.upsert.mockReturnValue("up" as never);
    prisma.projectDomainScope.deleteMany.mockReturnValue("del" as never);
    await run({ intent: "scopesBulk", "scope:d1:t1": " Build ", "scope:d2:t1": "", "scope:d3": "x", other: "y" }, true);
    expect(prisma.projectDomainScope.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.projectDomainScope.upsert.mock.calls[0][0]).toMatchObject({
      update: { scope: "Build", updatedById: "u1" },
    });
    expect(prisma.projectDomainScope.deleteMany).toHaveBeenCalledWith({
      where: { projectId: "p1", domainId: "d2", termId: "t1" },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(["up", "del"]);
  });

  it("scopesBulk with no cells writes nothing", async () => {
    await run({ intent: "scopesBulk" }, true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("domains keeps only active domain ids", async () => {
    prisma.domain.findMany.mockResolvedValue([{ id: "d1" }] as never);
    await run({ intent: "domains", domainId: ["d1", "stale"] }, true);
    expect(prisma.domain.findMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ["d1", "stale"] }, active: true },
    });
    expect(prisma.projectDomain.createMany.mock.calls[0][0]).toMatchObject({
      data: [{ projectId: "p1", domainId: "d1" }],
    });
  });

  it("terms replaces the term set for Core", async () => {
    await run({ intent: "terms", termId: ["t1", "t2"] }, true);
    expect(replaceProjectTerms).toHaveBeenCalledWith("p1", ["t1", "t2"]);
  });
});

describe("details", () => {
  it("normalizes slugs, lists and the term count", async () => {
    await run(
      {
        intent: "details",
        githubTeamSlug: " My Team_X! ",
        slackChannelName: ` Proj  Chat! ${"x".repeat(100)}`,
        termCount: "",
        repoUrls: "a\n\n b \n",
        figmaUrls: "",
        calendarEmail: "",
        deploymentUrl: "  ",
      },
      false,
    );
    const data = updateData();
    expect(data).toMatchObject({
      githubTeamSlug: "my-team-x",
      termCount: 1,
      repoUrls: ["a", "b"],
      figmaUrls: [],
      calendarEmail: null,
      deploymentUrl: null,
    });
    expect(data.slackChannelName).toMatch(/^proj-chat-x+$/);
    expect(data.slackChannelName).toHaveLength(80);
  });

  it("clears blank slugs to null", async () => {
    await run({ intent: "details", githubTeamSlug: "", slackChannelName: "" }, false);
    expect(updateData()).toMatchObject({ githubTeamSlug: null, slackChannelName: null });
  });
});
