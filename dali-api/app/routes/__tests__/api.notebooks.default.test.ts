import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/notebook-default.server", () => ({ resolveDefaultNotebook: vi.fn() }));

import { requireMemberSession } from "~/lib/auth";
import { resolveDefaultNotebook } from "~/lib/notebook-default.server";
import { loader } from "~/routes/api.notebooks.default";

const get = (query: string) =>
  loader({ request: new Request(`http://os.test/api/notebooks/default${query}`) } as never) as Promise<Response>;

const result = { kind: "new", notebook: null, newPath: "General ▸ Meetings" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(resolveDefaultNotebook).mockResolvedValue(result as never);
});

describe("GET /api/notebooks/default", () => {
  it("returns the resolver's answer as is", async () => {
    const res = await get("?scopeType=None");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
  });

  it("parses every param for the signed-in member", async () => {
    await get("?meetingId=m1&scopeType=Group&groupId=g1&projectId=p1&isCoreMeeting=1");

    expect(resolveDefaultNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "u1",
        meetingId: "m1",
        scopeType: "Group",
        groupId: "g1",
        projectId: "p1",
        isCoreMeeting: true,
        request: expect.any(Request),
      }),
    );
  });

  it("passes the mentee of a 1:1 through", async () => {
    await get("?scopeType=UserList&pairMenteeId=mia");

    expect(resolveDefaultNotebook).toHaveBeenCalledWith(expect.objectContaining({ pairMenteeId: "mia" }));
  });

  it("leaves absent and empty params undefined and the Core flag false", async () => {
    await get("?scopeType=UserList&meetingId=&projectId=");

    expect(resolveDefaultNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "UserList",
        meetingId: undefined,
        groupId: undefined,
        projectId: undefined,
        isCoreMeeting: false,
      }),
    );
  });

  it("reads the Core flag only as 1", async () => {
    expect((await get("?scopeType=None&isCoreMeeting=true")).status).toBe(400);
    expect(resolveDefaultNotebook).not.toHaveBeenCalled();
  });

  it("requires a known scopeType", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?scopeType=Everyone")).status).toBe(400);
    expect(resolveDefaultNotebook).not.toHaveBeenCalled();
  });

  it("answers the session gate's refusal", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);

    expect((await get("?scopeType=None")).status).toBe(401);
    expect(resolveDefaultNotebook).not.toHaveBeenCalled();
  });
});
