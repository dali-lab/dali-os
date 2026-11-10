// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { MeetingStrip, type StripRecorder } from "./MeetingStrip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(props: {
  recorder: StripRecorder | null;
  attendance?: { label: string; onClick?: () => void; to?: string } | null;
  noteHref?: string | null;
}) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(MeetingStrip, {
          title: "Fall kickoff",
          subtitle: "Thu, Nov 5, 10:00 AM · Studio A",
          attendance: props.attendance === undefined ? { label: "12 of 15", onClick: () => {} } : props.attendance,
          recorder: props.recorder,
          noteHref: props.noteHref,
        }),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/x"] }));
  });
}

const labels = () =>
  [...container.querySelectorAll<HTMLElement>("button, a")].map((el) =>
    [...el.querySelectorAll("span:not([aria-hidden])")].map((span) => span.textContent).join(" "),
  );

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MeetingStrip", () => {
  it("is a 60px strip with the title and subtitle on the left", async () => {
    await mount({ recorder: null });
    const strip = container.querySelector<HTMLElement>("[data-testid=meeting-strip]")!;
    expect(strip.className).toContain("h-[60px]");
    expect(strip.className).toContain("bg-os-card");
    expect(strip.textContent).toContain("Fall kickoff");
    expect(container.querySelector("[data-testid=meeting-strip-subtitle]")!.textContent).toBe("Thu, Nov 5, 10:00 AM · Studio A");
  });

  it("before: Attendance with N of M comes first, then a filled Record", async () => {
    const onRecord = vi.fn();
    await mount({ recorder: { phase: "before", onRecord } });
    expect(labels()).toEqual(["Attendance 12 of 15", "Record"]);
    const record = [...container.querySelectorAll("button")].find((b) => b.textContent === "Record")!;
    expect(record.className).toContain("bg-os-accent");
    expect(record.className).toContain("h-[38px]");
    await act(async () => record.click());
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it("recording: a solid danger Stop button carries the timer, and there is no Record or Pause", async () => {
    const onStop = vi.fn();
    await mount({ recorder: { phase: "recording", elapsedSeconds: 768, onStop } });
    expect(labels()).toEqual(["Attendance 12 of 15", "Stop recording 12:48"]);
    const stop = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop recording"))!;
    expect(stop.className).toContain("bg-os-red");
    expect(container.querySelector("[data-testid=meeting-strip-timer]")!.textContent).toBe("12:48");
    expect(container.textContent).not.toContain("Pause");
    await act(async () => stop.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("recording by someone else: the Stop button is disabled", async () => {
    await mount({ recorder: { phase: "recording", elapsedSeconds: 5 } });
    const stop = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop recording"))!;
    expect(stop.hasAttribute("disabled")).toBe(true);
  });

  it("after: Transcript and a filled Enhance notes follow Attendance", async () => {
    const onTranscript = vi.fn();
    const onEnhance = vi.fn();
    await mount({ recorder: { phase: "after", onTranscript, onEnhance } });
    expect(labels()).toEqual(["Attendance 12 of 15", "Transcript", "Enhance notes"]);
    const enhance = [...container.querySelectorAll("button")].find((b) => b.textContent === "Enhance notes")!;
    expect(enhance.className).toContain("bg-os-accent");
    await act(async () => enhance.click());
    expect(onEnhance).toHaveBeenCalledTimes(1);
  });

  it("after: leaves out Enhance notes when it is not offered", async () => {
    await mount({ recorder: { phase: "after", onTranscript: () => {} } });
    expect(labels()).toEqual(["Attendance 12 of 15", "Transcript"]);
  });

  it("puts a Meeting note link before Attendance on a whiteboard", async () => {
    await mount({ recorder: null, noteHref: "/documents/n1", attendance: { label: "3 of 4", to: "/calendar/meeting/m1" } });
    expect(labels()).toEqual(["Meeting note", "Attendance 3 of 4"]);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/documents/n1", "/calendar/meeting/m1"]);
  });
});
