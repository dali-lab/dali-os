import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/hiring/lib/cycles");
vi.mock("~/hiring/lib/continued-interest.server", () => ({
  reuseWaitlistedApplication: vi.fn(),
  stopUsingWaitlistedApplication: vi.fn(),
  listWaitlistedApplications: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { getActiveCycleById, getOpenCycles } from "~/hiring/lib/cycles";
import {
  reuseWaitlistedApplication,
  stopUsingWaitlistedApplication,
} from "~/hiring/lib/continued-interest.server";
import {
  NEW_APPLICATION_ACTIONS,
  OWNED_APPLICATION_ACTIONS,
  PORTAL_APPLY_ACTIONS,
  resolveApplyTarget,
  runPortalApplyAction,
} from "../portal-apply-actions.server";
import { loadPortalApply } from "../portal-apply.server";

const db = prisma as any;
const OPEN = { id: "cycle-1", applicants: "Students", currentStatus: "Open", hasChallenges: false, startTermIds: [] };

function post(fields: Record<string, string>) {
  return new Request("http://localhost/portal/apply", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.application = {
    findFirst: vi.fn().mockResolvedValue({ id: "app-1", applicationCycleId: "cycle-1" }),
    update: vi.fn().mockResolvedValue({}),
  };
  db.domainApplication = {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({}),
  };
  db.domainApplicationCycle = { findMany: vi.fn().mockResolvedValue([]) };
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "user-1" } } as never);
  vi.mocked(getActiveCycleById).mockResolvedValue(OPEN as never);
});

describe("portal apply dispatch", () => {
  it("registers each intent", () => {
    expect(Object.keys(PORTAL_APPLY_ACTIONS).sort()).toEqual(
      ["create-draft", "save-draft", "stop-using-waitlisted", "submit", "update-domains", "use-waitlisted"].sort(),
    );
  });

  it("splits the intents into those that start an application and those that act on one", () => {
    expect(Object.keys(NEW_APPLICATION_ACTIONS).sort()).toEqual(["create-draft", "use-waitlisted"]);
    expect(Object.keys(OWNED_APPLICATION_ACTIONS).sort()).toEqual(["save-draft", "stop-using-waitlisted", "submit", "update-domains"]);
  });

  it("answers an unknown intent on an owned open application", async () => {
    expect(await runPortalApplyAction(post({ intent: "bogus", applicationId: "app-1" }))).toEqual({
      error: "Unknown intent",
    });
  });

  it("does not treat prototype keys as intents", async () => {
    expect(await runPortalApplyAction(post({ intent: "toString", applicationId: "app-1" }))).toEqual({
      error: "Unknown intent",
    });
  });
});

describe("resolveApplyTarget", () => {
  it("looks up an owned application by the caller's user id", async () => {
    const t = await resolveApplyTarget("save-draft", new URLSearchParams({ applicationId: "app-1" }) as never as FormData, "user-1");
    expect(db.application.findFirst).toHaveBeenCalledWith({
      where: { id: "app-1", userId: "user-1" },
      select: { id: true, applicationCycleId: true },
    });
    expect(t).toEqual({ cycle: OPEN, applicationId: "app-1" });
  });

  it("returns null for someone else's application", async () => {
    db.application.findFirst.mockResolvedValue(null);
    const fd = new FormData();
    fd.set("applicationId", "app-other");
    expect(await resolveApplyTarget("save-draft", fd, "user-1")).toBeNull();
  });

  it("uses the posted cycle for the intents that start an application", async () => {
    const fd = new FormData();
    fd.set("cycleId", "cycle-1");
    expect(await resolveApplyTarget("use-waitlisted", fd, "user-1")).toEqual({
      cycle: OPEN,
      applicationId: null,
    });
    expect(db.application.findFirst).not.toHaveBeenCalled();
  });
});

describe("save-draft", () => {
  it("refuses another user's application and writes nothing", async () => {
    db.application.findFirst.mockResolvedValue(null);
    const res = (await runPortalApplyAction(
      post({ intent: "save-draft", applicationId: "app-other", answers: "{}", domainAnswers: "[]" }),
    )) as Response;
    expect(res.status).toBe(409);
    expect(db.application.update).not.toHaveBeenCalled();
  });

  it("writes the general answers and the posted domain answers", async () => {
    db.domainApplication.findMany.mockResolvedValue([]);
    const res = await runPortalApplyAction(
      post({
        intent: "save-draft",
        applicationId: "app-1",
        answers: JSON.stringify({ name: "Ada" }),
        domainAnswers: JSON.stringify([{ domainApplicationId: "da-1", answers: { q: "a" } }]),
      }),
    );
    expect(res).toEqual({ saved: true });
    expect(db.application.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: { answers: { name: "Ada" } },
    });
    expect(db.domainApplication.updateMany).toHaveBeenCalledWith({
      where: { id: "da-1", applicationId: "app-1" },
      data: { answers: { q: "a" } },
    });
  });
});

describe("use-waitlisted and stop-using-waitlisted", () => {
  it("copies the waitlisted application into the cycle", async () => {
    vi.mocked(reuseWaitlistedApplication).mockResolvedValue(null as never);
    const res = await runPortalApplyAction(
      post({ intent: "use-waitlisted", cycleId: "cycle-1", waitlistedDomainApplicationId: "da-w" }),
    );
    expect(res).toEqual({ reused: true });
    expect(reuseWaitlistedApplication).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", waitlistedDomainApplicationId: "da-w", cycle: OPEN }),
    );
  });

  it("reports a waitlisted application that cannot be reused", async () => {
    vi.mocked(reuseWaitlistedApplication).mockResolvedValue({ error: "x" } as never);
    const res = await runPortalApplyAction(
      post({ intent: "use-waitlisted", cycleId: "cycle-1", waitlistedDomainApplicationId: "da-w" }),
    );
    expect(res).toEqual({ error: "That application can't be used for this cycle." });
  });

  it("stops using it only on an owned application", async () => {
    const res = await runPortalApplyAction(
      post({ intent: "stop-using-waitlisted", applicationId: "app-1", domainId: "dom-1" }),
    );
    expect(res).toEqual({ reused: false });
    expect(stopUsingWaitlistedApplication).toHaveBeenCalledWith({
      applicationId: "app-1",
      domainId: "dom-1",
      cycle: OPEN,
    });

    db.application.findFirst.mockResolvedValue(null);
    vi.mocked(stopUsingWaitlistedApplication).mockClear();
    const refused = (await runPortalApplyAction(
      post({ intent: "stop-using-waitlisted", applicationId: "app-x", domainId: "dom-1" }),
    )) as Response;
    expect(refused.status).toBe(409);
    expect(stopUsingWaitlistedApplication).not.toHaveBeenCalled();
  });
});

describe("loadPortalApply", () => {
  it("returns kind choose when several cycles are open", async () => {
    vi.mocked(getOpenCycles).mockResolvedValue([
      { id: "c1", name: "Fall", closeDate: null },
      { id: "c2", name: "Winter", closeDate: new Date("2026-12-01T00:00:00Z") },
    ] as never);
    const data = (await loadPortalApply(new Request("http://localhost/portal/apply"), undefined)) as any;
    expect(data.kind).toBe("choose");
    expect(data.choose.map((c: any) => c.id)).toEqual(["c1", "c2"]);
  });

  it("redirects to the portal when no cycle is open", async () => {
    vi.mocked(getOpenCycles).mockResolvedValue([] as never);
    const res = (await loadPortalApply(new Request("http://localhost/portal/apply"), undefined)) as Response;
    expect(res.headers.get("Location")).toBe("/portal");
  });
});
