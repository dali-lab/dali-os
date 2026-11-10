// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApplicationViewer } from "../ApplicationViewer";
import { DialogProvider } from "~/components/ui/dialog";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const essayQ: Question = { key: "essay", type: "textarea", required: false, data: { label: "Why DALI?" } };

let clip: HTMLDivElement;
let root: Root;

async function mount() {
  clip = document.createElement("div");
  clip.style.overflow = "hidden";
  document.body.appendChild(clip);
  root = createRoot(clip);
  await act(async () => {
    root.render(
      createElement(
        DialogProvider,
        null,
        createElement(ApplicationViewer, {
          application: {
            answers: { essay: "I love building things." },
            generalChallengeVersion: { questions: [essayQ] },
            domainApplications: [],
          },
          questionLabels: { essay: "Why DALI?" },
          initialAnnotations: [
            { id: "a1", fieldKey: "essay", start: 2, end: 6, comment: "Strong opener", color: "yellow" },
          ],
        }),
      ),
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  clip.remove();
});

describe("ApplicationViewer annotations", () => {
  it("opens a highlight's popover outside the clipping container", async () => {
    await mount();
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("love");
    await act(async () => mark!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const popover = document.querySelector('[role="dialog"][aria-label="Edit annotation"]');
    expect(popover).not.toBeNull();
    expect(clip.contains(popover)).toBe(false);
    expect((popover!.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Strong opener");
  });

  it("shows the hover comment outside the clipping container", async () => {
    await mount();
    const mark = document.querySelector("mark")!;
    await act(async () => mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
    const bubble = [...document.querySelectorAll("span")].find((el) => el.textContent === "Strong opener");
    expect(bubble).toBeDefined();
    expect(clip.contains(bubble!)).toBe(false);
  });
});
