import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { mentorshipWarning: { create: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("../../lib/visibility", () => ({ canViewMentorship: vi.fn() }));
vi.mock("../../lib/warnings.server", () => ({ canWarnMember: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { canViewMentorship } from "../../lib/visibility";
import { canWarnMember } from "../../lib/warnings.server";
import { action } from "../api.mentorship.warnings";

const create = (prisma as any).mentorshipWarning.create as ReturnType<typeof vi.fn>;
const body = { memberId: "mentee1", reason: "missed_meeting", notes: "No show", occurredOn: "2026-11-10" };

function post(payload: unknown, method = "POST") {
  return action({
    request: new Request("http://localhost/api/mentorship/warnings", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(payload) : undefined,
    }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  (requireAuth as any).mockResolvedValue({ ok: true, user: { sub: "mentor1" } });
  (canViewMentorship as any).mockResolvedValue(true);
  (canWarnMember as any).mockResolvedValue(true);
  create.mockResolvedValue({ id: "w1" });
});

describe("POST /api/mentorship/warnings", () => {
  it("creates an open warning attributed to the submitter", async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "w1" });
    expect(create).toHaveBeenCalledWith({
      data: {
        memberId: "mentee1",
        reason: "missed_meeting",
        notes: "No show",
        occurredOn: new Date("2026-11-10T00:00:00.000Z"),
        createdById: "mentor1",
      },
      select: { id: true },
    });
  });

  it("rejects non-POST methods", async () => {
    expect((await post(body, "PUT")).status).toBe(405);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects callers outside mentorship", async () => {
    (canViewMentorship as any).mockResolvedValue(false);
    expect((await post(body)).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a mentor warning someone who is not their mentee", async () => {
    (canWarnMember as any).mockResolvedValue(false);
    expect((await post(body)).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires notes when the reason is other", async () => {
    const res = await post({ ...body, reason: "other", notes: " " });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unknown reason and a bad date", async () => {
    expect((await post({ ...body, reason: "nope" })).status).toBe(400);
    expect((await post({ ...body, occurredOn: "11/10/2026" })).status).toBe(400);
  });
});
