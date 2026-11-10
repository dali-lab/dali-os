// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DialogProvider } from "~/components/ui/dialog";
import { TaskModal } from "../TaskModal";
import { CORE_TASK_MODAL_FEATURES } from "../task-modal-features";
import type { TaskBoardOptions } from "../../lib/task-board";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options: TaskBoardOptions = {
  members: [],
  domains: [],
  repoUrls: [],
  termSpans: [],
  epics: [],
  stories: [],
  projectFiles: [],
  terms: [],
  currentTermId: null,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(features?: typeof CORE_TASK_MODAL_FEATURES) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(DialogProvider, null, createElement(TaskModal, {
        projectId: "p1",
        options,
        allTasks: [],
        canManage: true,
        onClose: vi.fn(),
        onCreate: vi.fn(),
        features,
      })),
    );
  });
  return document.body.textContent ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("TaskModal epic and story pickers", () => {
  it("shows both by default", () => {
    const text = mount();
    expect(text).toContain("Epic");
    expect(text).toContain("User story");
  });

  it("hides both under the Core preset and keeps Blocked by", () => {
    const text = mount(CORE_TASK_MODAL_FEATURES);
    expect(text).not.toContain("User story");
    expect(text).not.toContain("No epic");
    expect(text).toContain("Blocked by");
  });
});
