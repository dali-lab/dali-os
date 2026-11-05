import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { project: { updateMany: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/partners/lib/partner-renewals.server", () => ({ setTermPi: vi.fn() }));
vi.mock("~/partners/lib/planning-spots.server", () => ({ setTermSpots: vi.fn() }));
vi.mock("~/partners/lib/planning-gap.server", () => ({ loadPlanningData: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { setTermPi } from "~/partners/lib/partner-renewals.server";
import { setTermSpots } from "~/partners/lib/planning-spots.server";
import { action } from "~/partners/routes/core.partners.planning";

async function post(body: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  const request = new Request("http://localhost/core/partners/planning", { method: "POST", body: form });
  const res = (await action({ request, params: {}, context: {} } as never)) as Response;
  return { status: res.status, body: await res.json() };
}

const updateMany = vi.mocked(prisma.project.updateMany);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(setTermPi).mockResolvedValue(true);
  vi.mocked(setTermSpots).mockResolvedValue("ok");
  updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("planning action access", () => {
  it("rejects non-Core members for every intent without writing", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    for (const intent of ["pi", "spots", "description"]) {
      const res = await post({ intent, projectId: "p1", termId: "t1", roles: "[]", description: "x" });
      expect(res.status).toBe(403);
    }
    expect(setTermPi).not.toHaveBeenCalled();
    expect(setTermSpots).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("requires a project", async () => {
    expect((await post({ intent: "description", description: "x" })).status).toBe(400);
  });

  it("rejects an unknown intent", async () => {
    expect(await post({ intent: "delete", projectId: "p1", termId: "t1" })).toMatchObject({ status: 400 });
  });
});

describe("description intent", () => {
  it("saves the trimmed description", async () => {
    const res = await post({ intent: "description", projectId: "p1", description: "  A new blurb  " });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "p1" }, data: { description: "A new blurb" } });
  });

  it("clears the description when it is left blank", async () => {
    await post({ intent: "description", projectId: "p1", description: "   " });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "p1" }, data: { description: null } });
  });

  it("rejects a description over 5000 characters", async () => {
    const res = await post({ intent: "description", projectId: "p1", description: "x".repeat(5001) });
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("404s when the project is gone", async () => {
    updateMany.mockResolvedValue({ count: 0 } as never);
    expect((await post({ intent: "description", projectId: "gone", description: "x" })).status).toBe(404);
  });
});

describe("spots intent", () => {
  it("passes the parsed spots for the term to setTermSpots", async () => {
    const res = await post({
      intent: "spots",
      projectId: "p1",
      termId: "t1",
      roles: JSON.stringify([{ domainId: "eng", slots: 3 }, { domainId: "des", slots: 0 }]),
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(setTermSpots).toHaveBeenCalledWith(prisma, {
      projectId: "p1",
      termId: "t1",
      roles: [
        { domainId: "eng", slots: 3 },
        { domainId: "des", slots: 0 },
      ],
    });
  });

  it("requires a term", async () => {
    expect((await post({ intent: "spots", projectId: "p1", roles: "[]" })).status).toBe(400);
    expect(setTermSpots).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{"],
    ["not a list", '{"domainId":"eng"}'],
    ["a missing domain", '[{"slots":1}]'],
    ["a negative count", '[{"domainId":"eng","slots":-1}]'],
    ["a non-number count", '[{"domainId":"eng","slots":"lots"}]'],
    ["an absurd count", '[{"domainId":"eng","slots":51}]'],
  ])("rejects spots with %s", async (_label, roles) => {
    const res = await post({ intent: "spots", projectId: "p1", termId: "t1", roles });
    expect(res.status).toBe(400);
    expect(setTermSpots).not.toHaveBeenCalled();
  });

  it("reports a domain that is no longer available", async () => {
    vi.mocked(setTermSpots).mockResolvedValue("unknown-domain");
    const res = await post({ intent: "spots", projectId: "p1", termId: "t1", roles: '[{"domainId":"x","slots":1}]' });
    expect(res).toMatchObject({ status: 400, body: { error: expect.stringContaining("domains") } });
  });

  it("reports a term the project is not on", async () => {
    vi.mocked(setTermSpots).mockResolvedValue("not-in-term");
    const res = await post({ intent: "spots", projectId: "p1", termId: "t9", roles: "[]" });
    expect(res).toMatchObject({ status: 400, body: { error: expect.stringContaining("not active") } });
  });
});

describe("pi intent", () => {
  it("still sets the PI for a term", async () => {
    const res = await post({ intent: "pi", projectId: "p1", termId: "t1", piUserId: "core-2" });
    expect(res.status).toBe(200);
    expect(setTermPi).toHaveBeenCalledWith(prisma, { projectId: "p1", termId: "t1", piUserId: "core-2" });
  });

  it("refuses a PI who is not Core", async () => {
    vi.mocked(isCore).mockImplementation(async (id: string) => id === "core-1");
    expect((await post({ intent: "pi", projectId: "p1", termId: "t1", piUserId: "member" })).status).toBe(400);
    expect(setTermPi).not.toHaveBeenCalled();
  });
});
