// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

import { act } from "react";
import { renderDom } from "~/test-utils/render";
import { useLeadCycleData, type LeadCycleDataState } from "../use-lead-cycle-data";

const fetchMock = vi.fn();
let latest: LeadCycleDataState;

function Harness({ viewRoundId, hasInterviews = true }: { viewRoundId: string; hasInterviews?: boolean }) {
  latest = useLeadCycleData({
    cycleId: "c1",
    viewRoundId,
    isMemberCycle: false,
    hasInterviews,
    initialStatus: "Draft",
    revalidateKey: null,
  });
  return null;
}

const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });

function route(interviews: () => Promise<unknown>) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/interviews?")) return interviews();
    if (url.includes("/status")) return json({ currentStatus: "Open" });
    if (url.includes("/rooms")) return json({ rooms: [{ id: "r1", name: "Room A" }] });
    if (url.includes("/reviewers")) return json([]);
    if (url.includes("/interviewers")) return json([]);
    if (url.includes("/interview-config")) return json(null);
    if (url.includes("/coverage")) return json(null);
    return json({});
  });
}

async function mount(props: { viewRoundId: string; hasInterviews?: boolean }) {
  const view = renderDom(<Harness {...props} />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("useLeadCycleData", () => {
  it("fetches round data with the round id and refetches when the round changes", async () => {
    route(() => json({ interviews: [], pending: [] }));
    const view = await mount({ viewRoundId: "interview-1" });
    const urls = () => fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls()).toContain("/api/hiring/cycles/c1/interviews?round=interview-1");
    expect(urls()).toContain("/api/hiring/cycles/c1/interviewers?round=interview-1");
    expect(urls()).toContain("/api/hiring/cycles/c1/coverage?round=interview-1");

    view.rerender(<Harness viewRoundId="interview-2" />);
    await act(async () => {});
    expect(urls()).toContain("/api/hiring/cycles/c1/interviews?round=interview-2");
  });

  it("skips the interview fetches when the cycle has no interviews", async () => {
    route(() => json({ interviews: [], pending: [] }));
    await mount({ viewRoundId: "interview-1", hasInterviews: false });
    expect(fetchMock.mock.calls.map((c) => c[0] as string).some((u) => u.includes("/interviews?"))).toBe(false);
  });

  it("sets empty interviews and invites when the response is not ok", async () => {
    route(() => json({ error: "nope" }, false));
    await mount({ viewRoundId: "interview-1" });
    expect(latest.interviews).toEqual([]);
    expect(latest.pendingInvites).toEqual([]);
  });

  it("tolerates the legacy array shape of the interviews response", async () => {
    route(() => json([{ id: "i1" }]));
    await mount({ viewRoundId: "interview-1" });
    expect(latest.interviews).toEqual([{ id: "i1" }]);
    expect(latest.pendingInvites).toEqual([]);
  });

  it("reads interviews and pending invites from the current response shape", async () => {
    route(() => json({ interviews: [{ id: "i1" }], pending: [{ id: "p1" }] }));
    await mount({ viewRoundId: "interview-1" });
    expect(latest.interviews).toEqual([{ id: "i1" }]);
    expect(latest.pendingInvites).toEqual([{ id: "p1" }]);
  });

  it("picks up a server-side status change and the room list on load", async () => {
    route(() => json({ interviews: [], pending: [] }));
    await mount({ viewRoundId: "interview-1" });
    expect(latest.cycleStatus).toBe("Open");
    expect(latest.availableRooms).toEqual([{ id: "r1", name: "Room A" }]);
  });
});
