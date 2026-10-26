import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: () => new Response("forbidden", { status: 403 }),
}));
vi.mock("~/lib/roles", () => ({ isLabMember: vi.fn() }));
vi.mock("~/calendar/routes/calendar.server", () => ({ loadParticipantOptions: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { loadParticipantOptions } from "~/calendar/routes/calendar.server";
import { loader } from "../api.calendar.participants";

const request = new Request("http://os.test/api/calendar/participants");
const get = () => loader({ request, params: {} } as never) as Promise<Response>;

const OPTIONS = {
  groups: [{ id: "g1", name: "Core", memberIds: ["ada"], projectId: null, systemKey: "core" }],
  users: [{ id: "ada", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" }],
  mentorPairs: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as never);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(loadParticipantOptions).mockResolvedValue(OPTIONS as never);
});

describe("GET /api/calendar/participants", () => {
  it("returns the lab directory for a member", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OPTIONS);
    expect(loadParticipantOptions).toHaveBeenCalledWith(request, "ada");
  });

  it("refuses a non-member without reading the directory", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    expect(loadParticipantOptions).not.toHaveBeenCalled();
  });

  it("passes an auth failure through", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    expect((await get()).status).toBe(401);
    expect(loadParticipantOptions).not.toHaveBeenCalled();
  });
});
