import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    mentorNote: { findUnique: vi.fn(), create: vi.fn() },
    mentorNoteTemplate: { findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../../lib/visibility", () => ({
  canViewMentorship: vi.fn(),
  mentorNoteWhere: vi.fn(),
}));
vi.mock("../../lib/pair-notebook.server", () => ({ ensureMentorNotePage: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { canViewMentorship } from "../../lib/visibility";
import { ensureMentorNotePage } from "../../lib/pair-notebook.server";
import { action } from "../api.mentorship.notes";

const m = prisma as any;

const BODY = { menteeId: "mentee", projectId: "p1", termId: "t1", domainId: "d1", weekOf: "2026-10-14" };

function post(body: unknown = BODY) {
  return action({
    request: new Request("http://localhost/api/mentorship/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "mentor" } } as any);
  vi.mocked(canViewMentorship).mockResolvedValue(true);
});

describe("POST /api/mentorship/notes", () => {
  it("gives a newly created note its notebook tab, as the caller, with the Monday of the week", async () => {
    const created = { id: "n1", mentorId: "mentor", pageId: null, contentJson: { a: 1 } };
    m.mentorNote.findUnique.mockResolvedValue(null);
    m.mentorNoteTemplate.findFirst.mockResolvedValue({ contentJson: { a: 1 } });
    m.mentorNote.create.mockResolvedValue(created);

    const res = await post();

    expect(await res.json()).toEqual({ id: "n1", created: true });
    expect(ensureMentorNotePage).toHaveBeenCalledWith(created, "mentor");
    expect(m.mentorNote.create.mock.calls[0][0].data.weekOf).toEqual(new Date("2026-10-12T00:00:00Z"));
  });

  it("opens an existing note without making another tab", async () => {
    m.mentorNote.findUnique.mockResolvedValue({ id: "n1" });

    expect(await (await post()).json()).toEqual({ id: "n1", created: false });
    expect(m.mentorNote.create).not.toHaveBeenCalled();
    expect(ensureMentorNotePage).not.toHaveBeenCalled();
  });
});
