import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), getActiveCoreCycleTermIds: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { action } from "~/partners/routes/core.partners.settings";

const db = prisma as unknown as Record<string, any>;

function callAction(fields: Record<string, string | string[]>) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => form.append(k, x));
    else form.append(k, v);
  }
  const request = new Request("http://localhost/core/partners/settings", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", type: "member" },
  } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  db.partnerCrmSettings.upsert.mockResolvedValue({});
});

describe("partner CRM settings action", () => {
  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await callAction({ intent: "settings-save", staleDays: "7" });
    expect(res).toMatchObject({ error: expect.stringContaining("permission") });
    expect(db.partnerCrmSettings.upsert).not.toHaveBeenCalled();
  });

  it("saves the interview panel and stale threshold", async () => {
    const res = await callAction({
      intent: "settings-save",
      interviewPanelUserIds: ["u1", "u2"],
      staleDays: "21",
    });
    expect(res).toEqual({ ok: true });
    expect(db.partnerCrmSettings.upsert).toHaveBeenCalledWith({
      where: { id: "default" },
      create: { id: "default", interviewPanelUserIds: ["u1", "u2"], staleDays: 21 },
      update: { interviewPanelUserIds: ["u1", "u2"], staleDays: 21 },
    });
  });

  it("falls back to the default stale threshold for a non-positive value", async () => {
    await callAction({ intent: "settings-save", staleDays: "0" });
    expect(db.partnerCrmSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ staleDays: 14 }) }),
    );
  });

  it("an empty interview panel means everyone", async () => {
    await callAction({ intent: "settings-save", staleDays: "14" });
    expect(db.partnerCrmSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ interviewPanelUserIds: [] }) }),
    );
  });

  it("rejects an unknown intent", async () => {
    const res = await callAction({ intent: "explode" });
    expect(res).toMatchObject({ error: "Unknown action." });
  });
});
