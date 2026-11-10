// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { DocEditorInstance } from "~/components/doc/schema/build";
import { useRecordingEditor } from "./use-recording-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountWith(document: unknown[]) {
  const removeBlocks = vi.fn();
  const replaceBlocks = vi.fn();
  const editor = {
    document,
    onChange: () => {},
    getBlock: (id: string) => (document as { id: string }[]).find((b) => b.id === id),
    removeBlocks,
    replaceBlocks,
  } as unknown as DocEditorInstance;
  let hook: ReturnType<typeof useRecordingEditor> | null = null;
  function Harness() {
    hook = useRecordingEditor({ notePath: "/documents/p1" });
    return null;
  }
  const root = createRoot(window.document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  hook!.onEditorReady(editor);
  return { hook: hook!, removeBlocks, replaceBlocks, unmount: () => act(() => root.unmount()) };
}

const line = (id: string) => ({ id, type: "paragraph", props: {}, content: [], children: [] });

describe("onTaskCreated", () => {
  it("replaces the suggestion line with a task block", () => {
    const { hook, replaceBlocks, unmount } = mountWith([line("a")]);
    hook.hookProps.onTaskCreated("a", { taskId: "t1", projectId: "proj", label: "Buy plates" });
    expect(replaceBlocks).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "a" })],
      [{ type: "task", props: { taskId: "t1", projectId: "proj", label: "Buy plates" } }],
    );
    unmount();
  });

  it("does nothing when the line is already gone", () => {
    const { hook, replaceBlocks, unmount } = mountWith([line("a")]);
    hook.hookProps.onTaskCreated("gone", { taskId: "t1", projectId: "proj", label: "Buy plates" });
    expect(replaceBlocks).not.toHaveBeenCalled();
    unmount();
  });
});

describe("onRemoveBlock", () => {
  it("removes a suggestion line", () => {
    const { hook, removeBlocks, unmount } = mountWith([line("a")]);
    hook.hookProps.onRemoveBlock("a");
    expect(removeBlocks).toHaveBeenCalledWith(["a"]);
    unmount();
  });

  it("ignores a line that is already gone", () => {
    const { hook, removeBlocks, unmount } = mountWith([line("a")]);
    hook.hookProps.onRemoveBlock("gone");
    expect(removeBlocks).not.toHaveBeenCalled();
    unmount();
  });
});
