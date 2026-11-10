// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

vi.mock("~/components/meeting-recorder/RecordStartSheet", () => ({
  RecordStartSheet: () => createElement("div", { "data-testid": "start-sheet" }),
}));
vi.mock("~/components/AttendanceChecklist", () => ({
  AttendanceChecklist: () => createElement("div", { "data-testid": "checklist" }),
}));

const { NoteMeetingStrip, stripRecorderFor } = await import("./NoteMeetingStrip");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function fakeRec(over: Record<string, unknown> = {}) {
  return {
    canShowRecorder: true,
    canEdit: true,
    phase: "idle",
    elapsed: 0,
    drives: true,
    hasTranscript: false,
    aiEnabled: true,
    enhancedAt: null,
    recordedSeconds: 0,
    setOpen: vi.fn(),
    stop: vi.fn(),
    enhanceNow: vi.fn(),
    ...over,
  };
}

const attendance = {
  meetingId: "m1",
  occurrenceStart: "2026-11-05T15:00:00.000Z",
  meetingLabel: "Core",
  canMark: true,
  walletConfigured: false,
  rows: [
    { userId: "a", name: "Ada", present: true },
    { userId: "b", name: "Bo", present: false },
    { userId: "c", name: "Cy", present: true },
  ],
};

async function mount(rec: ReturnType<typeof fakeRec> | null) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(NoteMeetingStrip, {
          title: "Fall kickoff",
          source: { startIso: "2026-11-05T15:00:00.000Z", location: null, roomNames: ["Studio A"] },
          attendance,
          rec: rec as never,
        }),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/documents/n1"] }));
  });
}

const buttons = () => [...container.querySelectorAll("button")];
const byText = (t: string) => buttons().find((b) => b.textContent?.includes(t))!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("NoteMeetingStrip", () => {
  it("shows Attendance first with attended of expected, and the room before recording", async () => {
    await mount(fakeRec());
    expect(buttons()[0].textContent).toContain("Attendance");
    expect(buttons()[0].textContent).toContain("2 of 3");
    expect(container.querySelector("[data-testid=meeting-strip-subtitle]")!.textContent).toContain("Studio A");
  });

  it("starts the existing recorder path: Record opens the start sheet through rec.setOpen", async () => {
    const rec = fakeRec();
    await mount(rec);
    expect(container.querySelector("[data-testid=start-sheet]")).not.toBeNull();
    await act(async () => byText("Record").click());
    expect(rec.setOpen).toHaveBeenCalledWith(true);
  });

  it("shows the timer inside Stop and stops through rec.stop while recording", async () => {
    const rec = fakeRec({ phase: "recording", elapsed: 768 });
    await mount(rec);
    expect(byText("Stop recording").textContent).toContain("12:48");
    expect(container.textContent).not.toContain("Record" + "ing");
    await act(async () => byText("Stop recording").click());
    expect(rec.stop).toHaveBeenCalledTimes(1);
  });

  it("shows Recorded N min, Transcript and Enhance notes after a recording", async () => {
    const rec = fakeRec({ phase: "done", hasTranscript: true, recordedSeconds: 2520 });
    await mount(rec);
    expect(container.querySelector("[data-testid=meeting-strip-subtitle]")!.textContent).toContain("Recorded 42 min");
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(["Attendance2 of 3", "Transcript", "Enhance notes"]);
    await act(async () => byText("Enhance notes").click());
    expect(rec.enhanceNow).toHaveBeenCalledTimes(1);
    await act(async () => byText("Transcript").click());
    expect(rec.setOpen).toHaveBeenCalledWith(true);
  });

  it("offers no recorder controls without a recorder", async () => {
    await mount(null);
    expect(buttons().map((b) => b.textContent)).toEqual(["Attendance2 of 3"]);
  });

  it("opens the attendance checklist from the Attendance button", async () => {
    await mount(fakeRec());
    await act(async () => buttons()[0].click());
    expect(document.body.querySelector("[data-testid=checklist]")).not.toBeNull();
  });
});

describe("stripRecorderFor", () => {
  it("hides Record from someone who cannot edit, and hides Enhance once enhanced", () => {
    expect(stripRecorderFor(fakeRec({ canEdit: false }) as never)).toBeNull();
    const done = stripRecorderFor(fakeRec({ phase: "done", hasTranscript: true, enhancedAt: "2026-11-05" }) as never);
    expect(done).toMatchObject({ phase: "after", onEnhance: undefined });
  });

  it("only lets the recorder's owner stop", () => {
    const other = stripRecorderFor(fakeRec({ phase: "recording", drives: false }) as never);
    expect(other).toMatchObject({ phase: "recording", onStop: undefined });
  });
});
