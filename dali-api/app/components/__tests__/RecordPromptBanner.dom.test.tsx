// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router", () => ({ Link: "a" }));
vi.mock("~/lib/desktop", () => ({ desktopVersion: () => null }));
vi.mock("~/components/meeting-recorder/record-prompt-window", () => ({ isRecordPromptWindow: () => true }));
vi.mock("~/components/ui/floating", () => ({
  Menu: Object.assign(
    ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
    {
      Item: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) =>
        createElement("button", { type: "button", onClick: onSelect }, children),
    },
  ),
}));

const { RecordPromptBanner } = await import("~/components/RecordPromptBanner");

let container: HTMLDivElement;
let root: Root;
const onDontSuggest = vi.fn();

beforeEach(async () => {
  onDontSuggest.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(RecordPromptBanner, {
        meetingId: "m1",
        occurrenceStart: "2026-10-20T14:00:00.000Z",
        windowEndIso: "2026-10-20T15:00:00.000Z",
        canEdit: true,
        recordingEnabled: true,
        recordPromptEnabled: true,
        hasActiveRecording: false,
        canDontSuggest: true,
        onRecord: () => {},
        onDontSuggest,
      }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

describe("RecordPromptBanner", () => {
  it("hides at once when the organizer chooses not to suggest recording", async () => {
    expect(container.textContent).toContain("Record it?");
    const item = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Don't suggest"),
    )!;
    await act(async () => item.click());
    expect(onDontSuggest).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Record it?");
  });
});
