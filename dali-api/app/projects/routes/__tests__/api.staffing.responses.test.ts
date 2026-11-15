import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    formSubmission: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    staffingCycleFormBinding: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/forms/lib/public-form", () => ({ buildPublicForm: vi.fn(), submitStaffingFormFor: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { buildPublicForm, submitStaffingFormFor } from "~/forms/lib/public-form";
import { action, loader } from "../api.staffing.responses";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const get = (query: string) =>
  loader({ request: new Request(`http://os.test/api/staffing/responses?${query}`) } as never) as Promise<Response>;
const post = (body: unknown) =>
  action({
    request: new Request("http://os.test/api/staffing/responses", { method: "POST", body: JSON.stringify(body) }),
  } as never) as Promise<Response>;
const BODY = { cycleId: "c1", slot: "intent-to-work", userId: "m1", versionId: "v1", versionUpdatedAt: "x", answers: { a: "Yes" } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "mgr" } } as never);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  db.formSubmission.findMany.mockResolvedValue([{ userId: "m2" }]);
});

describe("staffing responses access", () => {
  it("refuses someone who can't manage staffing", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    expect((await get("cycleId=c1&slot=intent-to-work&q=ada")).status).toBe(403);
    expect((await post(BODY)).status).toBe(403);
    expect(submitStaffingFormFor).not.toHaveBeenCalled();
  });

  it("refuses while the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await post(BODY)).status).toBe(403);
    expect(submitStaffingFormFor).not.toHaveBeenCalled();
  });

  it("needs a real board", async () => {
    expect((await get("cycleId=c1&slot=payroll&q=ada")).status).toBe(400);
    expect((await post({ ...BODY, slot: "payroll" })).status).toBe(400);
  });
});

describe("staffing responses search", () => {
  it("lists matching members without a response yet", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "m1", firstName: "Ada", lastName: "Example", daliEmail: "ada@example.edu", dartmouthEmail: null },
      { id: "m2", firstName: "Adam", lastName: "Example", daliEmail: null, dartmouthEmail: null },
    ]);
    const res = await get("cycleId=c1&slot=intent-to-work&q=ad");
    expect(await res.json()).toEqual({ results: [{ userId: "m1", name: "Ada Example", email: "ada@example.edu" }] });
    expect(db.formSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staffingCycleId: "c1", slot: "intent-to-work", userId: { not: null } } }),
    );
  });

  it("waits for two letters", async () => {
    expect(await (await get("cycleId=c1&slot=intent-to-work&q=a")).json()).toEqual({ results: [] });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("staffing responses form for a member", () => {
  it("serves the form as that member would see it", async () => {
    const version = { id: "v1", questions: [], intro: null, updatedAt: new Date() };
    const form = { id: "f1", name: "Intent", publicToken: "tok", page: null, versions: [version], cycleBindings: [] };
    db.staffingCycleFormBinding.findUnique.mockResolvedValue({ form });
    vi.mocked(buildPublicForm).mockResolvedValue({ formId: "f1", name: "Intent" } as never);
    const res = await get("cycleId=c1&slot=intent-to-work&userId=m1");
    expect(await res.json()).toEqual({ form: { formId: "f1", name: "Intent", token: "tok" } });
    expect(buildPublicForm).toHaveBeenCalledWith(form, version, "m1");
  });

  it("refuses a member who already responded", async () => {
    const res = await get("cycleId=c1&slot=intent-to-work&userId=m2");
    expect(res.status).toBe(409);
    expect(buildPublicForm).not.toHaveBeenCalled();
  });

  it("says when no form is connected", async () => {
    db.staffingCycleFormBinding.findUnique.mockResolvedValue(null);
    expect((await get("cycleId=c1&slot=intent-to-work&userId=m1")).status).toBe(404);
  });
});

describe("staffing responses add", () => {
  it("adds the response as the manager", async () => {
    vi.mocked(submitStaffingFormFor).mockResolvedValue({ ok: true, submissionId: "s1" });
    expect(await (await post(BODY)).json()).toEqual({ ok: true });
    expect(submitStaffingFormFor).toHaveBeenCalledWith(
      expect.objectContaining({
        staffingCycleId: "c1",
        slot: "intent-to-work",
        userId: "m1",
        enteredById: "mgr",
        versionId: "v1",
        versionUpdatedAt: "x",
        answers: { a: "Yes" },
      }),
    );
  });

  it("rejects malformed input and passes back refusals", async () => {
    expect((await post({ ...BODY, answers: ["Yes"] })).status).toBe(400);
    expect((await post({ ...BODY, userId: 4 })).status).toBe(400);
    vi.mocked(submitStaffingFormFor).mockResolvedValue({ error: "They already have a response for this term.", status: 409 });
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "They already have a response for this term." });
  });
});
