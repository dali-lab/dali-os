import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/db.server", () => ({ prisma: { page: { findUniqueOrThrow: vi.fn() } } }));
vi.mock("~/lib/note-path.server", () => ({
  formatFiledPath: (parts: string[]) => parts.join(" ▸ "),
  notebookLocationParts: vi.fn(),
}));
vi.mock("~/mentorship/lib/pair-notebook.server", () => ({ ensurePairNotebook: vi.fn() }));
vi.mock("~/mentorship/lib/pair-suggestion.server", () => ({ findMentorPair: vi.fn() }));

import { requireMemberSession } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { notebookLocationParts } from "~/lib/note-path.server";
import { ensurePairNotebook } from "~/mentorship/lib/pair-notebook.server";
import { findMentorPair } from "~/mentorship/lib/pair-suggestion.server";
import { action } from "~/routes/api.notebooks.mentorship-pair";

const post = (body: unknown, method = "POST") =>
  action({
    request: new Request("http://os.test/api/notebooks/mentorship-pair", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
  } as never) as Promise<Response>;

const pair = { mentorId: "u1", menteeId: "mia", projectId: "p1", termId: "t1", domainId: "d1" };
const page = { id: "pair-nb", title: "Mia Chen with Me (F26)", workspaceType: "Lab", workspaceId: null, parentPageId: "f-mentor" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(findMentorPair).mockResolvedValue(pair);
  vi.mocked(ensurePairNotebook).mockResolvedValue({ id: "pair-nb" });
  vi.mocked(prisma.page.findUniqueOrThrow).mockResolvedValue(page as never);
  vi.mocked(notebookLocationParts).mockResolvedValue(["Mentorship", "Mentor notebooks"]);
});

describe("POST /api/notebooks/mentorship-pair", () => {
  it("makes sure the caller's pair notebook exists and answers in the picker's shape", async () => {
    const res = await post({ menteeId: "mia" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...page, path: "Mentorship ▸ Mentor notebooks" });
    expect(findMentorPair).toHaveBeenCalledWith("u1", "mia", expect.any(Request));
    expect(ensurePairNotebook).toHaveBeenCalledWith({ ...pair, actorId: "u1" });
  });

  it("404s a person the caller does not mentor, and makes nothing", async () => {
    vi.mocked(findMentorPair).mockResolvedValue(null);

    expect((await post({ menteeId: "zed" })).status).toBe(404);
    expect(ensurePairNotebook).not.toHaveBeenCalled();
  });

  it("400s a body without a mentee", async () => {
    expect((await post({})).status).toBe(400);
    expect(findMentorPair).not.toHaveBeenCalled();
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "PUT")).status).toBe(405);
  });

  it("returns the session gate's response when not a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response("no", { status: 403 }) } as never);

    expect((await post({ menteeId: "mia" })).status).toBe(403);
    expect(ensurePairNotebook).not.toHaveBeenCalled();
  });
});
