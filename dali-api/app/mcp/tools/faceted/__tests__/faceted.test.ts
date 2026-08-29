// Tests for the six faceted manage_* tools.
// Mocks all underlying modules so we can assert routing without a DB.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Stub the underlying tool modules ────────────────────────────────────────

vi.mock("../../create-sprint", () => ({
  CREATE_SPRINT_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["projectId", "name", "startsAt", "endsAt"] },
  },
  runCreateSprint: vi.fn(),
}));
vi.mock("../../update-sprint", () => ({
  UPDATE_SPRINT_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["sprintId"] },
  },
  runUpdateSprint: vi.fn(),
}));
vi.mock("../../set-sprint-status", () => ({
  SET_SPRINT_STATUS_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["sprintId", "status"] },
  },
  runSetSprintStatus: vi.fn(),
}));
vi.mock("../../delete-sprint", () => ({
  DELETE_SPRINT_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["sprintId"] },
  },
  runDeleteSprint: vi.fn(),
}));

vi.mock("../../create-epic", () => ({
  CREATE_EPIC_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["projectId", "title"] },
  },
  runCreateEpic: vi.fn(),
}));
vi.mock("../../update-epic", () => ({
  UPDATE_EPIC_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["epicId"] },
  },
  runUpdateEpic: vi.fn(),
}));
vi.mock("../../delete-epic", () => ({
  DELETE_EPIC_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["epicId"] },
  },
  runDeleteEpic: vi.fn(),
}));

vi.mock("../../create-story", () => ({
  CREATE_STORY_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["epicId", "title"] },
  },
  runCreateStory: vi.fn(),
}));
vi.mock("../../update-story", () => ({
  UPDATE_STORY_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["storyId"] },
  },
  runUpdateStory: vi.fn(),
}));
vi.mock("../../delete-story", () => ({
  DELETE_STORY_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["storyId"] },
  },
  runDeleteStory: vi.fn(),
}));

vi.mock("../../time-entries", () => ({
  ADD_TIME_ENTRY_TOOL: {
    inputSchema: {
      type: "object",
      properties: {},
      required: ["date", "hours", "assignmentType", "roleRefId"],
    },
  },
  UPDATE_TIME_ENTRY_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["id"] },
  },
  DELETE_TIME_ENTRY_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["id"] },
  },
  runAddTimeEntry: vi.fn(),
  runUpdateTimeEntry: vi.fn(),
  runDeleteTimeEntry: vi.fn(),
}));

vi.mock("../../document-curation", () => ({
  SET_DOCUMENT_SHARING_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["pageId"] },
  },
  DELETE_PROJECT_DOCUMENT_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["pageId"] },
  },
  SET_FILE_SHARING_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["fileId", "partnerVisible"] },
  },
  DELETE_PROJECT_FILE_TOOL: {
    inputSchema: { type: "object", properties: {}, required: ["fileId"] },
  },
  runSetDocumentSharing: vi.fn(),
  runDeleteProjectDocument: vi.fn(),
  runSetFileSharing: vi.fn(),
  runDeleteProjectFile: vi.fn(),
}));

// ─── Import faceted tools AFTER mocks ────────────────────────────────────────

import { MANAGE_SPRINT_TOOL } from "../manage-sprint";
import { MANAGE_EPIC_TOOL } from "../manage-epic";
import { MANAGE_STORY_TOOL } from "../manage-story";
import { MANAGE_TIME_ENTRY_TOOL } from "../manage-time-entry";
import { MANAGE_DOCUMENT_SHARING_TOOL } from "../manage-document-sharing";

import { runCreateSprint } from "../../create-sprint";
import { runUpdateSprint } from "../../update-sprint";
import { runSetSprintStatus } from "../../set-sprint-status";
import { runDeleteSprint } from "../../delete-sprint";

import { runCreateEpic } from "../../create-epic";
import { runUpdateEpic } from "../../update-epic";
import { runDeleteEpic } from "../../delete-epic";

import { runCreateStory } from "../../create-story";
import { runUpdateStory } from "../../update-story";
import { runDeleteStory } from "../../delete-story";

import { runAddTimeEntry, runUpdateTimeEntry, runDeleteTimeEntry } from "../../time-entries";
import {
  runSetDocumentSharing,
  runDeleteProjectDocument,
  runSetFileSharing,
  runDeleteProjectFile,
} from "../../document-curation";

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

// ─── manage_sprint ────────────────────────────────────────────────────────────

describe("manage_sprint", () => {
  it("advertises mcp:write scope", () => {
    expect(MANAGE_SPRINT_TOOL.def.requiredScope).toBe("mcp:write");
  });

  it("unknown action throws McpInvalidError", async () => {
    await expect(
      MANAGE_SPRINT_TOOL.run(ctx, { action: "explode" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("create routes to runCreateSprint with userId and stripped args", async () => {
    vi.mocked(runCreateSprint).mockResolvedValue({ id: "s1" } as any);
    await MANAGE_SPRINT_TOOL.run(ctx, {
      action: "create",
      projectId: "p1",
      name: "Sprint 1",
      startsAt: "2026-06-01",
      endsAt: "2026-06-14",
    });
    expect(runCreateSprint).toHaveBeenCalledWith("user-1", {
      projectId: "p1",
      name: "Sprint 1",
      startsAt: "2026-06-01",
      endsAt: "2026-06-14",
    });
  });

  it("update routes to runUpdateSprint", async () => {
    vi.mocked(runUpdateSprint).mockResolvedValue({ ok: true, sprintId: "s1" } as any);
    await MANAGE_SPRINT_TOOL.run(ctx, { action: "update", sprintId: "s1", name: "New Name" });
    expect(runUpdateSprint).toHaveBeenCalledWith("user-1", { sprintId: "s1", name: "New Name" });
  });

  it("set_status routes to runSetSprintStatus", async () => {
    vi.mocked(runSetSprintStatus).mockResolvedValue({
      ok: true,
      sprintId: "s1",
      previousStatus: "Planned",
      newStatus: "Active",
    } as any);
    await MANAGE_SPRINT_TOOL.run(ctx, { action: "set_status", sprintId: "s1", status: "Active" });
    expect(runSetSprintStatus).toHaveBeenCalledWith("user-1", { sprintId: "s1", status: "Active" });
  });

  it("delete routes to runDeleteSprint", async () => {
    vi.mocked(runDeleteSprint).mockResolvedValue({ ok: true, sprintId: "s1" } as any);
    await MANAGE_SPRINT_TOOL.run(ctx, { action: "delete", sprintId: "s1" });
    expect(runDeleteSprint).toHaveBeenCalledWith("user-1", { sprintId: "s1" });
  });

  it("create missing required field throws McpInvalidError", async () => {
    // Missing name, startsAt, endsAt
    await expect(
      MANAGE_SPRINT_TOOL.run(ctx, { action: "create", projectId: "p1" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("set_status missing status throws McpInvalidError", async () => {
    await expect(
      MANAGE_SPRINT_TOOL.run(ctx, { action: "set_status", sprintId: "s1" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });
});

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

  it("add routes to runAddTimeEntry with userId and stripped args (passes confirmed through)", async () => {
    vi.mocked(runAddTimeEntry).mockResolvedValue({ ok: true, id: "te1" } as any);
    await MANAGE_TIME_ENTRY_TOOL.run(ctx, {
      action: "add",
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

  it("add missing required fields throws McpInvalidError", async () => {
    // Missing hours, assignmentType, roleRefId
    await expect(
      MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "add", date: "2026-08-01" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("delete missing id throws McpInvalidError", async () => {
    await expect(
      MANAGE_TIME_ENTRY_TOOL.run(ctx, { action: "delete" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });
});

// ─── manage_document_sharing ──────────────────────────────────────────────────

describe("manage_document_sharing", () => {
  it("advertises mcp:write scope", () => {
    expect(MANAGE_DOCUMENT_SHARING_TOOL.def.requiredScope).toBe("mcp:write");
  });

  it("unknown action throws McpInvalidError", async () => {
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "explode" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("set_document_sharing routes to runSetDocumentSharing with userId and stripped args", async () => {
    vi.mocked(runSetDocumentSharing).mockResolvedValue({
      ok: true,
      partnerVisible: true,
      publicVisible: false,
      pinned: false,
    } as any);
    await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
      action: "set_document_sharing",
      pageId: "pg1",
      partnerVisible: true,
    });
    expect(runSetDocumentSharing).toHaveBeenCalledWith("user-1", {
      pageId: "pg1",
      partnerVisible: true,
    });
  });

  it("delete_document routes to runDeleteProjectDocument", async () => {
    vi.mocked(runDeleteProjectDocument).mockResolvedValue({
      ok: true,
      archived: true,
      deleted: false,
    } as any);
    await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
      action: "delete_document",
      pageId: "pg1",
    });
    expect(runDeleteProjectDocument).toHaveBeenCalledWith("user-1", { pageId: "pg1" });
  });

  it("set_file_sharing routes to runSetFileSharing", async () => {
    vi.mocked(runSetFileSharing).mockResolvedValue({ ok: true, partnerVisible: false } as any);
    await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, {
      action: "set_file_sharing",
      fileId: "f1",
      partnerVisible: false,
    });
    expect(runSetFileSharing).toHaveBeenCalledWith("user-1", { fileId: "f1", partnerVisible: false });
  });

  it("delete_file routes to runDeleteProjectFile", async () => {
    vi.mocked(runDeleteProjectFile).mockResolvedValue({
      ok: true,
      alreadyArchived: false,
    } as any);
    await MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "delete_file", fileId: "f1" });
    expect(runDeleteProjectFile).toHaveBeenCalledWith("user-1", { fileId: "f1" });
  });

  it("set_document_sharing missing pageId throws McpInvalidError", async () => {
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "set_document_sharing" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("set_file_sharing missing partnerVisible throws McpInvalidError", async () => {
    await expect(
      MANAGE_DOCUMENT_SHARING_TOOL.run(ctx, { action: "set_file_sharing", fileId: "f1" }),
    ).rejects.toBeInstanceOf(McpInvalidError);
  });
});
