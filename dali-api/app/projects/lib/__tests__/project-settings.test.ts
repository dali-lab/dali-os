import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { project: { update: vi.fn() } } }));
vi.mock("~/lib/groups", () => ({ ensureProjectGroup: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { ensureProjectGroup } from "~/lib/groups";
import {
  linesToList,
  normalizeGithubTeamSlug,
  normalizeSlackChannelName,
  normalizeTermCount,
  updateProjectSettings,
  type ProjectSettingsPatch,
} from "../project-settings.server";

const update = prisma.project.update as unknown as ReturnType<typeof vi.fn>;

const save = (patch: ProjectSettingsPatch, isCore = true) =>
  updateProjectSettings({ projectId: "p1", isCore, patch });

beforeEach(() => vi.clearAllMocks());

describe("normalizers", () => {
  it("normalizes a GitHub team slug", () => {
    expect(normalizeGithubTeamSlug("  My Cool_Team! ")).toBe("my-cool-team");
    expect(normalizeGithubTeamSlug("  ")).toBeNull();
  });

  it("normalizes a Slack channel name to 80 characters", () => {
    expect(normalizeSlackChannelName(" Proj  Chat! ")).toBe("proj-chat");
    expect(normalizeSlackChannelName("a".repeat(100))).toHaveLength(80);
    expect(normalizeSlackChannelName("")).toBeNull();
  });

  it("splits lines and drops blanks", () => {
    expect(linesToList("a\n\n b \n")).toEqual(["a", "b"]);
  });

  it("clamps the term count to at least 1", () => {
    expect(normalizeTermCount(0)).toBe(1);
    expect(normalizeTermCount(NaN)).toBe(1);
    expect(normalizeTermCount(2.9)).toBe(2);
  });
});

describe("updateProjectSettings", () => {
  it.each([
    { status: "Archived" },
    { isPrivate: true },
    { recordingPolicy: "Disabled" as const },
  ])("refuses %j for a non-Core caller", async (patch) => {
    await expect(save(patch, false)).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it("lets Core set the Core-only fields", async () => {
    await save({ status: "Paused", isPrivate: false, recordingPolicy: "Allowed" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "Paused", isPrivate: false, recordingPolicy: "Allowed" },
    });
  });

  it("lets a non-Core caller edit the other fields", async () => {
    await save({ description: " hi ", termCount: 0, repoUrls: [" a ", ""] }, false);
    expect(update.mock.calls[0][0].data).toEqual({ description: "hi", termCount: 1, repoUrls: ["a"] });
  });

  it("rejects an invalid status", async () => {
    await expect(save({ status: "Deleted" })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a blank name and an empty patch", async () => {
    await expect(save({ name: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(save({})).rejects.toMatchObject({ status: 400 });
    await expect(save({ description: undefined })).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("syncs the project group on rename only", async () => {
    await save({ name: " Atlas " }, false);
    expect(ensureProjectGroup).toHaveBeenCalledWith("p1", "Atlas");
    vi.mocked(ensureProjectGroup).mockClear();
    await save({ description: "x" }, false);
    expect(ensureProjectGroup).not.toHaveBeenCalled();
  });
});
