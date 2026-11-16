import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  mentorshipWarning: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("../../lib/warnings.server", () => ({ requireWarningsAdmin: vi.fn() }));

import { requireWarningsAdmin } from "../../lib/warnings.server";
import { action, loader } from "../mentorship.warnings";

const request = () => new Request("http://localhost/mentorship/warnings");
const post = (fields: Record<string, string>) =>
  action({
    request: new Request("http://localhost/mentorship/warnings", { method: "POST", body: new URLSearchParams(fields) }),
  } as never);

const VALID = { intent: "create", memberId: "m1", reason: "missed_lab", notes: " Skipped ", occurredOn: "2026-11-02" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireWarningsAdmin).mockResolvedValue("core1");
  db.user.findUnique.mockResolvedValue({ id: "m1" });
});

describe("access", () => {
  it.each([302, 403, 404])("loader and action stop when the guard throws %i", async (status) => {
    vi.mocked(requireWarningsAdmin).mockRejectedValue(new Response(null, { status }));
    await expect(loader({ request: request() } as never)).rejects.toMatchObject({ status });
    await expect(post(VALID)).rejects.toMatchObject({ status });
    expect(db.mentorshipWarning.create).not.toHaveBeenCalled();
  });
});

describe("loader", () => {
  it("returns warnings and active members", async () => {
    db.mentorshipWarning.findMany.mockResolvedValue([
      {
        id: "w1",
        reason: "other",
        notes: "n",
        occurredOn: new Date("2026-11-02T00:00:00Z"),
        status: "resolved",
        member: { id: "m1", name: "", firstName: "Ada", lastName: "Lovelace", photoUrl: null },
      },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "m1", name: "Ada L", firstName: "Ada", lastName: "Lovelace", photoUrl: null }]);
    const data = await loader({ request: request() } as never);
    expect(data.warnings).toEqual([
      {
        id: "w1",
        member: { id: "m1", name: "Ada Lovelace", photoUrl: null },
        reason: "other",
        notes: "n",
        occurredOn: "2026-11-02",
        status: "resolved",
      },
    ]);
    expect(data.members).toEqual([{ id: "m1", name: "Ada L", photoUrl: null }]);
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ membershipStatus: "Active" });
  });
});

describe("action create and update", () => {
  it("creates an open warning stamped with the author", async () => {
    expect(await post(VALID)).toEqual({ ok: true, intent: "create", message: "Warning saved." });
    expect(db.mentorshipWarning.create).toHaveBeenCalledWith({
      data: { memberId: "m1", reason: "missed_lab", notes: "Skipped", occurredOn: new Date("2026-11-02T00:00:00.000Z"), createdById: "core1" },
    });
  });

  it("updates by id without changing the author", async () => {
    expect(await post({ ...VALID, intent: "update", id: "w1", reason: "missed_meeting" })).toEqual({
      ok: true,
      intent: "update",
      message: "Warning updated.",
    });
    expect(db.mentorshipWarning.update).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { memberId: "m1", reason: "missed_meeting", notes: "Skipped", occurredOn: new Date("2026-11-02T00:00:00.000Z") },
    });
  });

  it.each([
    [{ memberId: "" }, "Pick a member."],
    [{ reason: "late" }, "Pick a reason."],
    [{ occurredOn: "tomorrow" }, "Pick a date."],
    [{ reason: "other", notes: "  " }, "Add notes when the reason is Other."],
  ])("rejects invalid input %o", async (override, error) => {
    expect(await post({ ...VALID, ...override })).toEqual({ ok: false, error });
    expect(db.mentorshipWarning.create).not.toHaveBeenCalled();
  });

  it("rejects a member that no longer exists", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await post(VALID)).toEqual({ ok: false, error: "That member no longer exists." });
    expect(db.mentorshipWarning.create).not.toHaveBeenCalled();
  });
});

describe("action status and delete", () => {
  it("resolves and reopens", async () => {
    expect(await post({ intent: "status", id: "w1", status: "resolved" })).toMatchObject({ ok: true, message: "Marked resolved." });
    expect(db.mentorshipWarning.update).toHaveBeenLastCalledWith({ where: { id: "w1" }, data: { status: "resolved" } });
    expect(await post({ intent: "status", id: "w1", status: "open" })).toMatchObject({ ok: true, message: "Reopened." });
    expect(db.mentorshipWarning.update).toHaveBeenLastCalledWith({ where: { id: "w1" }, data: { status: "open" } });
  });

  it("rejects an unknown status", async () => {
    expect(await post({ intent: "status", id: "w1", status: "archived" })).toEqual({ ok: false, error: "Invalid status." });
    expect(db.mentorshipWarning.update).not.toHaveBeenCalled();
  });

  it("deletes by id", async () => {
    expect(await post({ intent: "delete", id: "w1" })).toMatchObject({ ok: true, message: "Warning deleted." });
    expect(db.mentorshipWarning.delete).toHaveBeenCalledWith({ where: { id: "w1" } });
  });

  it.each(["update", "status", "delete"])("rejects %s without an id", async (intent) => {
    expect(await post({ ...VALID, intent, status: "open" })).toEqual({ ok: false, error: "Pick a warning." });
    expect(db.mentorshipWarning.update).not.toHaveBeenCalled();
    expect(db.mentorshipWarning.delete).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    expect(await post({ intent: "purge", id: "w1" })).toEqual({ ok: false, error: "Unknown action." });
    expect(db.mentorshipWarning.delete).not.toHaveBeenCalled();
  });
});
