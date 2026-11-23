// Tests for the faceted manage_* tools.
// Mocks all underlying modules so we can assert routing without a DB.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Stub the underlying tool modules ────────────────────────────────────────

vi.mock("../../create-epic", () => ({
  CREATE_EPIC_PROPERTIES: {},
  CREATE_EPIC_REQUIRED: ["projectId", "title"],
  runCreateEpic: vi.fn(),
}));
vi.mock("../../update-epic", () => ({
  UPDATE_EPIC_PROPERTIES: {},
  UPDATE_EPIC_REQUIRED: ["epicId"],
  runUpdateEpic: vi.fn(),
}));
vi.mock("../../delete-epic", () => ({
  DELETE_EPIC_PROPERTIES: {},
  DELETE_EPIC_REQUIRED: ["epicId"],
  runDeleteEpic: vi.fn(),
}));

vi.mock("../../create-story", () => ({
  CREATE_STORY_PROPERTIES: {},
  CREATE_STORY_REQUIRED: ["epicId", "title"],
  runCreateStory: vi.fn(),
}));
vi.mock("../../update-story", () => ({
  UPDATE_STORY_PROPERTIES: {},
  UPDATE_STORY_REQUIRED: ["storyId"],
  runUpdateStory: vi.fn(),
}));
vi.mock("../../delete-story", () => ({
  DELETE_STORY_PROPERTIES: {},
  DELETE_STORY_REQUIRED: ["storyId"],
  runDeleteStory: vi.fn(),
}));

vi.mock("../../time-entries", () => ({
  ADD_TIME_ENTRY_PROPERTIES: {},
  ADD_TIME_ENTRY_REQUIRED: ["date", "hours", "assignmentType", "roleRefId"],
  UPDATE_TIME_ENTRY_PROPERTIES: {},
  UPDATE_TIME_ENTRY_REQUIRED: ["id"],
  DELETE_TIME_ENTRY_PROPERTIES: {},
  DELETE_TIME_ENTRY_REQUIRED: ["id"],
  runAddTimeEntry: vi.fn(),
  runUpdateTimeEntry: vi.fn(),
  runDeleteTimeEntry: vi.fn(),
}));

vi.mock("../../projects-extra/provision-epic-description-doc", () => ({
  runProvisionEpicDescriptionDoc: vi.fn(),
}));

// ─── Import faceted tools AFTER mocks ────────────────────────────────────────

import { MANAGE_EPIC_TOOL } from "../manage-epic";
import { MANAGE_STORY_TOOL } from "../manage-story";
import { MANAGE_TIME_ENTRY_TOOL } from "../manage-time-entry";

import { runCreateEpic } from "../../create-epic";
import { runUpdateEpic } from "../../update-epic";
import { runDeleteEpic } from "../../delete-epic";
import { runProvisionEpicDescriptionDoc } from "../../projects-extra/provision-epic-description-doc";

import { runCreateStory } from "../../create-story";
import { runUpdateStory } from "../../update-story";
import { runDeleteStory } from "../../delete-story";

import { runAddTimeEntry, runUpdateTimeEntry, runDeleteTimeEntry } from "../../time-entries";
import { McpInvalidError } from "../../../errors";

// ─── Shared test ctx ─────────────────────────────────────────────────────────

const ctx = {
  user: {
    id: "user-1",
    daliEmail: null,
    dartmouthEmail: null,
    netId: null,
    firstName: "Test",
    lastName: "User",
  },
  scopes: ["mcp:write"],
  request: new Request("http://localhost/"),
};

beforeEach(() => vi.clearAllMocks());

// ─── manage_epic ─────────────────────────────────────────────────────────────

describe("manage_epic", () => {
  it("advertises mcp:write scope", () => {
    expect(MANAGE_EPIC_TOOL.def.requiredScope).toBe("mcp:write");
  });

  it("unknown action throws McpInvalidError", async () => {
    await expect(
      MANAGE_EPIC_TOOL.run(ctx, { action: "explode" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("create routes to runCreateEpic with userId and stripped args", async () => {
    vi.mocked(runCreateEpic).mockResolvedValue({ id: "e1" } as any);
    await MANAGE_EPIC_TOOL.run(ctx, { action: "create", projectId: "p1", title: "Epic A" });
    expect(runCreateEpic).toHaveBeenCalledWith("user-1", { projectId: "p1", title: "Epic A" });
  });

  it("update routes to runUpdateEpic", async () => {
    vi.mocked(runUpdateEpic).mockResolvedValue({ ok: true, epicId: "e1" } as any);
    await MANAGE_EPIC_TOOL.run(ctx, { action: "update", epicId: "e1", title: "Renamed" });
    expect(runUpdateEpic).toHaveBeenCalledWith("user-1", { epicId: "e1", title: "Renamed" });
  });

  it("delete routes to runDeleteEpic", async () => {
    vi.mocked(runDeleteEpic).mockResolvedValue({ ok: true, epicId: "e1" } as any);
    await MANAGE_EPIC_TOOL.run(ctx, { action: "delete", epicId: "e1" });
    expect(runDeleteEpic).toHaveBeenCalledWith("user-1", { epicId: "e1" });
  });

  it("provision_description_doc routes to the provisioner as the caller", async () => {
    vi.mocked(runProvisionEpicDescriptionDoc).mockResolvedValue({ descriptionDocId: "d1" });
    await expect(MANAGE_EPIC_TOOL.run(ctx, { action: "provision_description_doc", epicId: "e1" })).resolves.toEqual({
      descriptionDocId: "d1",
    });
    expect(runProvisionEpicDescriptionDoc).toHaveBeenCalledWith("user-1", { epicId: "e1" });
  });

  it("provision_description_doc without epicId throws McpInvalidError", async () => {
    await expect(
      MANAGE_EPIC_TOOL.run(ctx, { action: "provision_description_doc" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
    expect(runProvisionEpicDescriptionDoc).not.toHaveBeenCalled();
  });

  it("create missing required field throws McpInvalidError", async () => {
    // Missing title
    await expect(
      MANAGE_EPIC_TOOL.run(ctx, { action: "create", projectId: "p1" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });
});

// ─── manage_story ─────────────────────────────────────────────────────────────

describe("manage_story", () => {
  it("advertises mcp:write scope", () => {
    expect(MANAGE_STORY_TOOL.def.requiredScope).toBe("mcp:write");
  });

  it("unknown action throws McpInvalidError", async () => {
    await expect(
      MANAGE_STORY_TOOL.run(ctx, { action: "explode" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("create routes to runCreateStory with userId and stripped args", async () => {
    vi.mocked(runCreateStory).mockResolvedValue({ id: "st1" } as any);
    await MANAGE_STORY_TOOL.run(ctx, { action: "create", epicId: "e1", title: "As a user..." });
    expect(runCreateStory).toHaveBeenCalledWith("user-1", { epicId: "e1", title: "As a user..." });
  });

  it("update routes to runUpdateStory", async () => {
    vi.mocked(runUpdateStory).mockResolvedValue({ ok: true, storyId: "st1" } as any);
    await MANAGE_STORY_TOOL.run(ctx, { action: "update", storyId: "st1", title: "Renamed" });
    expect(runUpdateStory).toHaveBeenCalledWith("user-1", { storyId: "st1", title: "Renamed" });
  });

  it("delete routes to runDeleteStory", async () => {
    vi.mocked(runDeleteStory).mockResolvedValue({ ok: true, storyId: "st1" } as any);
    await MANAGE_STORY_TOOL.run(ctx, { action: "delete", storyId: "st1" });
    expect(runDeleteStory).toHaveBeenCalledWith("user-1", { storyId: "st1" });
  });

  it("create missing title throws McpInvalidError", async () => {
    await expect(
      MANAGE_STORY_TOOL.run(ctx, { action: "create", epicId: "e1" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });
});

// ─── manage_time_entry ────────────────────────────────────────────────────────

describe("manage_time_entry", () => {
  it("advertises mcp:write scope", () => {
    expect(MANAGE_TIME_ENTRY_TOOL.def.requiredScope).toBe("mcp:write");
  });

  it("unknown action throws McpInvalidError", async () => {
    await expect(
      MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "explode" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("rejects the old add action", async () => {
    await expect(
      MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "add", date: "2026-08-01", hours: 2, assignmentType: "Project", roleRefId: "r1" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("create routes to runAddTimeEntry with userId and stripped args (passes confirmed through)", async () => {
    vi.mocked(runAddTimeEntry).mockResolvedValue({ ok: true, id: "te1" } as any);
    await MANAGE_TIME_ENTRY_TOOL.run(ctx, {
      action: "create",
      date: "2026-08-01",
      hours: 2,
      assignmentType: "Project",
      roleRefId: "r1",
      confirmed: true,
    });
    expect(runAddTimeEntry).toHaveBeenCalledWith("user-1", {
      date: "2026-08-01",
      hours: 2,
      assignmentType: "Project",
      roleRefId: "r1",
      confirmed: true,
    });
  });

  it("update routes to runUpdateTimeEntry", async () => {
    vi.mocked(runUpdateTimeEntry).mockResolvedValue({ ok: true } as any);
    await MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "update", id: "te1", hours: 3 });
    expect(runUpdateTimeEntry).toHaveBeenCalledWith("user-1", { id: "te1", hours: 3 });
  });

  it("delete routes to runDeleteTimeEntry", async () => {
    vi.mocked(runDeleteTimeEntry).mockResolvedValue({ ok: true } as any);
    await MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "delete", id: "te1" });
    expect(runDeleteTimeEntry).toHaveBeenCalledWith("user-1", { id: "te1" });
  });

  it("create missing required fields throws McpInvalidError", async () => {
    // Missing hours, assignmentType, roleRefId
    await expect(
      MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "create", date: "2026-08-01" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("delete missing id throws McpInvalidError", async () => {
    await expect(
      MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "delete" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });
});
