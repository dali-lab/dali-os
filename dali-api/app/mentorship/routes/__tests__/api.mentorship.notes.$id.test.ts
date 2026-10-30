import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    mentorNote: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    project: { findUnique: vi.fn() },
    term: { findUnique: vi.fn() },
    domain: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../../lib/visibility", () => ({ canViewMentorship: vi.fn(), canViewMentorNote: vi.fn() }));
vi.mock("../../lib/note-body.server", () => ({ readMentorNoteBlocks: vi.fn() }));
vi.mock("../../lib/pair-notebook.server", () => ({ archiveMentorNotePage: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { isCore } from "~/lib/roles";
import { canViewMentorship, canViewMentorNote } from "../../lib/visibility";
import { readMentorNoteBlocks } from "../../lib/note-body.server";
import { archiveMentorNotePage } from "../../lib/pair-notebook.server";
import { action, loader } from "../api.mentorship.notes.$id";

const m = prisma as any;

const NOTE = {
  id: "n1",
  mentorId: "mentor",
  menteeId: "mentee",
  projectId: "p1",
  termId: "t1",
  domainId: "d1",
  weekOf: new Date("2026-10-12T00:00:00Z"),
  contentJson: [{ type: "paragraph", content: "stale" }],
  pageId: "page1",
  vibe: null,
  updatedAt: new Date("2026-10-13T00:00:00Z"),
};

const get = () => loader({ request: new Request("http://localhost/api/mentorship/notes/n1"), params: { id: "n1" } } as any);
const del = () =>
  action({
    request: new Request("http://localhost/api/mentorship/notes/n1", { method: "DELETE" }),
    params: { id: "n1" },
  } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "mentor" } } as any);
  vi.mocked(canViewMentorship).mockResolvedValue(true);
  vi.mocked(canViewMentorNote).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  m.project.findUnique.mockResolvedValue(null);
  m.term.findUnique.mockResolvedValue(null);
  m.domain.findUnique.mockResolvedValue(null);
});

describe("GET /api/mentorship/notes/:id", () => {
  it("returns the body read through the note's page, not the stale column", async () => {
    const fromRoom = [{ type: "paragraph", content: "live" }];
    m.mentorNote.findUnique.mockResolvedValue(NOTE);
    vi.mocked(readMentorNoteBlocks).mockResolvedValue(fromRoom as never);

    const body = await (await get()).json();

    expect(readMentorNoteBlocks).toHaveBeenCalledWith(expect.objectContaining({ pageId: "page1" }));
    expect(body.contentJson).toEqual(fromRoom);
  });

  it("gates on the note's page access via canViewMentorNote", async () => {
    m.mentorNote.findUnique.mockResolvedValue(NOTE);
    vi.mocked(canViewMentorNote).mockResolvedValue(false);

    const res = await get();

    expect(canViewMentorNote).toHaveBeenCalledWith("mentor", expect.objectContaining({ pageId: "page1" }));
    expect(res.status).toBe(403);
    expect(readMentorNoteBlocks).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/mentorship/notes/:id", () => {
  it("deletes the note and trashes its page", async () => {
    m.mentorNote.findUnique.mockResolvedValue({ id: "n1", mentorId: "mentor", pageId: "page1" });

    await del();

    expect(m.mentorNote.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(archiveMentorNotePage).toHaveBeenCalledWith("page1");
  });

  it("logs the delete with the people and project but no note content", async () => {
    m.mentorNote.findUnique.mockResolvedValue({
      id: "n1",
      mentorId: "mentor",
      menteeId: "mentee",
      projectId: "p1",
      termId: "t1",
      pageId: "page1",
    });

    await del();

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mentorship.note.delete",
        userId: "mentor",
        targetId: "n1",
        metadata: { mentorId: "mentor", menteeId: "mentee", projectId: "p1", termId: "t1" },
      }),
    );
  });

  it("leaves another mentor's note and page alone", async () => {
    m.mentorNote.findUnique.mockResolvedValue({ id: "n1", mentorId: "someone-else", pageId: "page1" });

    const res = await del();

    expect(res.status).toBe(403);
    expect(m.mentorNote.delete).not.toHaveBeenCalled();
    expect(archiveMentorNotePage).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
