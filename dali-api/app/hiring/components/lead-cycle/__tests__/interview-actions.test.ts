import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reassignInterviewer } from "../interview-actions";

const interview = { id: "i1" };
const assignment = { id: "a1" };

function setup(confirm = true) {
  return {
    dialog: { confirm: vi.fn().mockResolvedValue(confirm) },
    toast: { error: vi.fn() },
    refresh: vi.fn(),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("reassignInterviewer", () => {
  it("does nothing when the confirm is declined", async () => {
    const s = setup(false);
    await reassignInterviewer({ interview, assignment, to: { id: "ci2", name: "Ada", availability: "free" }, ...s });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it("toasts the server error and does not refresh on a non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Already booked" }) });
    const s = setup();
    await reassignInterviewer({ interview, assignment, to: { id: "ci2", name: "Ada", availability: "free" }, ...s });
    expect(s.toast.error).toHaveBeenCalledWith("Already booked");
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic error when the body is not JSON", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new Error("bad"); } });
    const s = setup();
    await reassignInterviewer({ interview, assignment, to: { id: "ci2", name: "Ada", availability: "free" }, ...s });
    expect(s.toast.error).toHaveBeenCalledWith("Failed to reassign interviewer");
  });

  it("refreshes once on success", async () => {
    const s = setup();
    await reassignInterviewer({ interview, assignment, to: { id: "ci2", name: "Ada", availability: "free" }, ...s });
    expect(fetchMock).toHaveBeenCalledWith("/api/hiring/interviews/i1/reassign", expect.objectContaining({ method: "POST" }));
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["free", false],
    ["booked", false],
    ["busy", true],
    ["no-calendar", true],
  ] as const)("sends override only when needed (%s)", async (availability, expectOverride) => {
    const s = setup();
    await reassignInterviewer({ interview, assignment, to: { id: "ci2", name: "Ada", availability }, ...s });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ assignmentId: "a1", newCycleInterviewerId: "ci2" });
    expect("override" in body).toBe(expectOverride);
    expect(s.dialog.confirm.mock.calls[0][0].title).toBe(expectOverride ? "Assign Ada anyway?" : "Reassign interviewer?");
  });
});
