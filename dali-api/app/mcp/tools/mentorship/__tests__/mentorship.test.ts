import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isLabMentor: vi.fn() };
});
vi.mock("~/collab/legacy/pm-to-blocknote", () => ({
  ensureBlocks: (v: unknown) => v ?? [],
}));
vi.mock("~/collab/write", () => ({ replaceCollabDocContent: vi.fn() }));
vi.mock("~/collab/blocknote-server", () => ({
  markdownToBlocks: vi.fn(async () => [{ type: "paragraph" }]),
}));
// Stub the registry so the BY_NAME map side-effect doesn't pull in every
// tool module. We only need the error classes here.
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
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db";
import { isCore, isLabMentor } from "~/lib/roles";

import {
  runListMentorNotes,
  LIST_MENTOR_NOTES_TOOL,
} from "~/mcp/tools/mentorship/list-mentor-notes";
import {
  runGetMentorNote,
  GET_MENTOR_NOTE_TOOL,
} from "~/mcp/tools/mentorship/get-mentor-note";
import {
  runListMentorshipPairs,
  LIST_MENTORSHIP_PAIRS_TOOL,
} from "~/mcp/tools/mentorship/list-mentorship-pairs";
import {
  runListMentorNoteTemplates,
  LIST_MENTOR_NOTE_TEMPLATES_TOOL,
} from "~/mcp/tools/mentorship/list-mentor-note-templates";
import {
  runManageMentorNote,
  MANAGE_MENTOR_NOTE_TOOL,
} from "~/mcp/tools/mentorship/manage-mentor-note";
import {
  runManageMentorshipPair,
  MANAGE_MENTORSHIP_PAIR_TOOL,
} from "~/mcp/tools/mentorship/manage-mentorship-pair";
import {
  runManageMentorNoteTemplate,
  MANAGE_MENTOR_NOTE_TEMPLATE_TOOL,
} from "~/mcp/tools/mentorship/manage-mentor-note-template";
import { replaceCollabDocContent } from "~/collab/write";
import { markdownToBlocks } from "~/collab/blocknote-server";

type MockFn = ReturnType<typeof vi.fn>;
type ModelMock = Record<string, MockFn>;

const mockPrisma = prisma as unknown as {
  mentorNote: ModelMock;
  mentorNoteTemplate: ModelMock;
  mentorshipPair: ModelMock;
  project: ModelMock;
  term: ModelMock;
  domain: ModelMock;
  $transaction: MockFn;
};

const ME = "mentor-user";
const MENTEE = "mentee-user";
const NOTE_ID = "note-1";
const PAIR_ID = "pair-1";
const TEMPLATE_ID = "tpl-1";

const BASE_NOTE = {
  id: NOTE_ID,
  mentorId: ME,
  menteeId: MENTEE,
  projectId: "proj-1",
  termId: "term-1",
  domainId: "dom-1",
  weekOf: new Date("2026-08-04"),
  contentJson: {},
  vibe: null,
  updatedAt: new Date("2026-08-04"),
  mentor: { id: ME, firstName: "Alice", lastName: "Mentor" },
  mentee: { id: MENTEE, firstName: "Bob", lastName: "Mentee" },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller is a lab mentor (not Core)
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMentor).mockResolvedValue(true);
  mockPrisma.mentorshipPair.findMany.mockResolvedValue([]);
  mockPrisma.project.findMany.mockResolvedValue([]);
  mockPrisma.term.findMany.mockResolvedValue([]);
  mockPrisma.domain.findMany.mockResolvedValue([]);
});

// ─── Scope tags ─────────────────────────────────────────────────────────────

describe("tool scopes", () => {
  it("reads are mcp:read", () => {
    expect(LIST_MENTOR_NOTES_TOOL.requiredScope).toBe("mcp:read");
    expect(GET_MENTOR_NOTE_TOOL.requiredScope).toBe("mcp:read");
    expect(LIST_MENTORSHIP_PAIRS_TOOL.requiredScope).toBe("mcp:read");
    expect(LIST_MENTOR_NOTE_TEMPLATES_TOOL.requiredScope).toBe("mcp:read");
  });
  it("writes are mcp:write", () => {
    expect(MANAGE_MENTOR_NOTE_TOOL.requiredScope).toBe("mcp:write");
    expect(MANAGE_MENTORSHIP_PAIR_TOOL.requiredScope).toBe("mcp:write");
  });
  it("template management is mcp:admin", () => {
    expect(MANAGE_MENTOR_NOTE_TEMPLATE_TOOL.requiredScope).toBe("mcp:admin");
  });
});

// ─── Mentee-forbidden paths ──────────────────────────────────────────────────

describe("mentee visibility gate", () => {
  beforeEach(() => {
    vi.mocked(isLabMentor).mockResolvedValue(false);
    vi.mocked(isCore).mockResolvedValue(false);
  });

  it("list_mentor_notes forbids non-mentor non-Core", async () => {
    await expect(runListMentorNotes(MENTEE, {})).rejects.toMatchObject({ status: 403 });
  });

  it("get_mentor_note forbids non-mentor non-Core at the area gate", async () => {
    await expect(runGetMentorNote(MENTEE, { id: NOTE_ID })).rejects.toMatchObject({ status: 403 });
  });

  it("list_mentorship_pairs forbids non-mentor non-Core", async () => {
    await expect(runListMentorshipPairs(MENTEE, {})).rejects.toMatchObject({ status: 403 });
  });

  it("list_mentor_note_templates forbids non-mentor non-Core", async () => {
    await expect(runListMentorNoteTemplates(MENTEE)).rejects.toMatchObject({ status: 403 });
  });

  it("manage_mentor_note forbids non-mentor non-Core", async () => {
    await expect(
      runManageMentorNote(MENTEE, {
        action: "upsert",
        menteeId: "x",
        projectId: "p",
        termId: "t",
        domainId: "d",
        weekOf: "2026-08-04",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ─── list_mentor_notes happy path ────────────────────────────────────────────

describe("list_mentor_notes", () => {
  it("returns notes with denormalized labels for a lab mentor", async () => {
    mockPrisma.mentorNote.findMany.mockResolvedValue([
      {
        ...BASE_NOTE,
      },
    ]);
    mockPrisma.project.findMany.mockResolvedValue([{ id: "proj-1", name: "DALI OS" }]);
    mockPrisma.term.findMany.mockResolvedValue([{ id: "term-1", code: "26S" }]);
    mockPrisma.domain.findMany.mockResolvedValue([
      { id: "dom-1", code: "FS", displayName: "Fullstack" },
    ]);

    const out = (await runListMentorNotes(ME, {})) as { notes: unknown[] };
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toMatchObject({
      id: NOTE_ID,
      mentor: { id: ME },
      mentee: { id: MENTEE },
      project: { name: "DALI OS" },
      term: { code: "26S" },
      domain: { displayName: "Fullstack" },
    });
  });
});

// ─── get_mentor_note happy path ───────────────────────────────────────────────

describe("get_mentor_note", () => {
  it("returns full note content for the note's author", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue(BASE_NOTE);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "proj-1", name: "DALI OS" });
    mockPrisma.term.findUnique.mockResolvedValue({ id: "term-1", code: "26S" });
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: "dom-1",
      code: "FS",
      displayName: "Fullstack",
    });

    const out = (await runGetMentorNote(ME, { id: NOTE_ID })) as Record<string, unknown>;
    expect(out.id).toBe(NOTE_ID);
    expect(out.contentJson).toBeDefined();
    expect(out.vibe).toBeNull();
  });

  it("forbids a lab mentor who is not the author and not in the same domain", async () => {
    // Different mentor, different domain.
    mockPrisma.mentorNote.findUnique.mockResolvedValue({
      ...BASE_NOTE,
      mentorId: "other-mentor",
      domainId: "dom-99",
    });
    // Caller mentors only dom-1
    mockPrisma.mentorshipPair.findMany.mockResolvedValue([{ domainId: "dom-1" }]);

    await expect(runGetMentorNote(ME, { id: NOTE_ID })).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 for missing note", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue(null);
    await expect(runGetMentorNote(ME, { id: "nope" })).rejects.toMatchObject({ status: 404 });
  });
});

// ─── list_mentorship_pairs happy path ────────────────────────────────────────

describe("list_mentorship_pairs", () => {
  it("returns pairs for a lab mentor", async () => {
    mockPrisma.mentorshipPair.findMany.mockResolvedValue([
      {
        id: PAIR_ID,
        projectId: "proj-1",
        termId: "term-1",
        domainId: "dom-1",
        mentor: { id: ME, firstName: "Alice", lastName: "Mentor" },
        mentee: { id: MENTEE, firstName: "Bob", lastName: "Mentee" },
      },
    ]);
    mockPrisma.project.findMany.mockResolvedValue([{ id: "proj-1", name: "DALI OS" }]);
    mockPrisma.term.findMany.mockResolvedValue([{ id: "term-1", code: "26S" }]);
    mockPrisma.domain.findMany.mockResolvedValue([
      { id: "dom-1", code: "FS", displayName: "Fullstack" },
    ]);

    const out = (await runListMentorshipPairs(ME, {})) as { pairs: unknown[] };
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0]).toMatchObject({ id: PAIR_ID, mentor: { id: ME } });
  });
});

// ─── manage_mentor_note ───────────────────────────────────────────────────────

describe("manage_mentor_note", () => {
  it("upsert returns existing note when one already exists", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ id: NOTE_ID });
    const out = await runManageMentorNote(ME, {
      action: "upsert",
      menteeId: MENTEE,
      projectId: "proj-1",
      termId: "term-1",
      domainId: "dom-1",
      weekOf: "2026-08-04",
    });
    expect(out).toMatchObject({ id: NOTE_ID, created: false });
  });

  it("upsert creates and seeds from default template", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue(null);
    mockPrisma.mentorNoteTemplate.findFirst.mockResolvedValue({ contentJson: { blocks: [] } });
    mockPrisma.mentorNote.create.mockResolvedValue({ id: "note-new" });

    const out = await runManageMentorNote(ME, {
      action: "upsert",
      menteeId: MENTEE,
      projectId: "proj-1",
      termId: "term-1",
      domainId: "dom-1",
      weekOf: "2026-08-04",
    });
    expect(out).toMatchObject({ id: "note-new", created: true });
    expect(mockPrisma.mentorNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentJson: { blocks: [] } }),
      }),
    );
  });

  it("set_vibe updates the vibe field for the author", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ id: NOTE_ID, mentorId: ME });
    mockPrisma.mentorNote.update.mockResolvedValue({});

    const out = await runManageMentorNote(ME, { action: "set_vibe", id: NOTE_ID, vibe: "Good" });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.mentorNote.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { vibe: "Good" } }),
    );
  });

  it("set_vibe forbids a non-author non-Core caller", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ id: NOTE_ID, mentorId: "other-mentor" });
    await expect(
      runManageMentorNote(ME, { action: "set_vibe", id: NOTE_ID, vibe: "Ok" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("delete removes the note for the author", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ id: NOTE_ID, mentorId: ME });
    mockPrisma.mentorNote.delete.mockResolvedValue({});

    const out = await runManageMentorNote(ME, { action: "delete", id: NOTE_ID });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.mentorNote.delete).toHaveBeenCalledWith({ where: { id: NOTE_ID } });
  });

  it("rejects unknown action", async () => {
    await expect(
      runManageMentorNote(ME, { action: "unknown_action" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects upsert missing required field", async () => {
    await expect(
      runManageMentorNote(ME, { action: "upsert", menteeId: MENTEE }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ─── manage_mentorship_pair ───────────────────────────────────────────────────

describe("manage_mentorship_pair", () => {
  it("requires Core for create", async () => {
    await expect(
      runManageMentorshipPair(ME, {
        action: "create",
        menteeUserId: MENTEE,
        mentorUserId: ME,
        projectId: "p",
        termId: "t",
        domainId: "d",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires Core for delete", async () => {
    await expect(
      runManageMentorshipPair(ME, { action: "delete", id: PAIR_ID }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("Core can create a pair and gets created=true on new", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.mentorshipPair.findFirst.mockResolvedValue(null);
    mockPrisma.mentorshipPair.create.mockResolvedValue({ id: PAIR_ID });

    const out = await runManageMentorshipPair(ME, {
      action: "create",
      menteeUserId: MENTEE,
      mentorUserId: ME,
      projectId: "p",
      termId: "t",
      domainId: "d",
    });
    expect(out).toMatchObject({ id: PAIR_ID, created: true });
  });

  it("Core create returns created=false for a duplicate pair", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.mentorshipPair.findFirst.mockResolvedValue({ id: PAIR_ID });

    const out = await runManageMentorshipPair(ME, {
      action: "create",
      menteeUserId: MENTEE,
      mentorUserId: ME,
      projectId: "p",
      termId: "t",
      domainId: "d",
    });
    expect(out).toMatchObject({ id: PAIR_ID, created: false });
    expect(mockPrisma.mentorshipPair.create).not.toHaveBeenCalled();
  });

  it("Core can delete an existing pair", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.mentorshipPair.findUnique.mockResolvedValue({ id: PAIR_ID });
    mockPrisma.mentorshipPair.delete.mockResolvedValue({});

    const out = await runManageMentorshipPair(ME, { action: "delete", id: PAIR_ID });
    expect(out).toMatchObject({ ok: true });
  });

  it("delete 404s on missing pair", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.mentorshipPair.findUnique.mockResolvedValue(null);

    await expect(
      runManageMentorshipPair(ME, { action: "delete", id: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ─── manage_mentor_note_template ──────────────────────────────────────────────

describe("manage_mentor_note_template", () => {
  it("requires Core for all actions", async () => {
    await expect(
      runManageMentorNoteTemplate(ME, { action: "create", name: "New" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("Core can create a template", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        mentorNoteTemplate: {
          updateMany: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: TEMPLATE_ID }),
        },
      };
      return fn(fakeTx);
    });

    const out = await runManageMentorNoteTemplate(ME, { action: "create", name: "Week Template" });
    expect(out).toMatchObject({ id: TEMPLATE_ID });
  });

  it("create with content writes the body via collab and mirrors it into contentJson", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        mentorNoteTemplate: {
          updateMany: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: TEMPLATE_ID }),
        },
      }),
    );
    mockPrisma.mentorNoteTemplate.update.mockResolvedValue({});

    const out = await runManageMentorNoteTemplate(ME, {
      action: "create",
      name: "Week Template",
      content: "# Weekly check-in",
    });

    expect(out).toMatchObject({ id: TEMPLATE_ID });
    expect(markdownToBlocks).toHaveBeenCalledWith("# Weekly check-in");
    expect(replaceCollabDocContent).toHaveBeenCalledWith(
      `mentorNoteTemplate:${TEMPLATE_ID}:body`,
      [{ type: "paragraph" }],
      ME,
    );
    // Mirrored into the seed column so new notes pick it up.
    expect(mockPrisma.mentorNoteTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEMPLATE_ID },
        data: expect.objectContaining({ contentJson: [{ type: "paragraph" }] }),
      }),
    );
  });

  it("Core can set isDefault on create (clears others in tx)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const updateMany = vi.fn().mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        mentorNoteTemplate: {
          updateMany,
          create: vi.fn().mockResolvedValue({ id: TEMPLATE_ID }),
        },
      };
      return fn(fakeTx);
    });

    await runManageMentorNoteTemplate(ME, {
      action: "create",
      name: "Default Template",
      isDefault: true,
    });
    expect(updateMany).toHaveBeenCalledWith({ where: { isDefault: true }, data: { isDefault: false } });
  });

  it("Core can update template name", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.mentorNoteTemplate.findUnique.mockResolvedValue({ id: TEMPLATE_ID });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        mentorNoteTemplate: {
          updateMany: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(fakeTx);
    });

    const out = await runManageMentorNoteTemplate(ME, {
      action: "update",
      id: TEMPLATE_ID,
      name: "Renamed",
    });
    expect(out).toMatchObject({ ok: true });
  });

  it("Core can delete a template", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.mentorNoteTemplate.findUnique.mockResolvedValue({ id: TEMPLATE_ID });
    mockPrisma.mentorNoteTemplate.delete.mockResolvedValue({});

    const out = await runManageMentorNoteTemplate(ME, { action: "delete", id: TEMPLATE_ID });
    expect(out).toMatchObject({ ok: true });
  });

  it("delete 404s on missing template", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.mentorNoteTemplate.findUnique.mockResolvedValue(null);

    await expect(
      runManageMentorNoteTemplate(ME, { action: "delete", id: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
