import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
  forbidden: () => new Response("forbidden", { status: 403 }),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loader } from "../api.scheduled-meetings.$id.attendees";

const findMeeting = vi.mocked(prisma.scheduledMeeting.findUnique);

function get() {
  return loader({
    request: new Request("http://os.test/api/scheduled-meetings/m1/attendees"),
    params: { id: "m1" },
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "org-1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(false);
  findMeeting.mockResolvedValue({
    organizerId: "org-1",
    participantUserIds: ["u2", "u3"],
    status: "Confirmed",
  } as never);
});

describe("GET /api/scheduled-meetings/:id/attendees", () => {
  it("returns the organizer and participants to the organizer", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizerId: "org-1", participantUserIds: ["u2", "u3"] });
    expect(findMeeting).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "m1" } }));
  });

  it("returns them to Core too", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);

    expect((await get()).status).toBe(200);
  });

  it("refuses anyone else", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u2" } } as never);

    expect((await get()).status).toBe(403);
  });

  it("refuses a non-member", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);

    expect((await get()).status).toBe(403);
    expect(findMeeting).not.toHaveBeenCalled();
  });

  it("404s a missing or cancelled meeting", async () => {
    findMeeting.mockResolvedValue(null);
    expect((await get()).status).toBe(404);

    findMeeting.mockResolvedValue({ organizerId: "org-1", participantUserIds: [], status: "Cancelled" } as never);
    expect((await get()).status).toBe(404);
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);

    expect((await get()).status).toBe(401);
  });
});
