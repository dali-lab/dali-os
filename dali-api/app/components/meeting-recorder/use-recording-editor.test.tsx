// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { DocEditorInstance } from "~/components/doc/schema/build";
import { useRecordingEditor } from "./use-recording-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = (t: string) => ({ type: "text", text: t, styles: {} });
const chip = (at: number, label: string) => ({ type: "link", href: `/documents/p1?transcript=r1&at=${at}`, content: [text(label)] });
const checklist = (id: string, ...content: unknown[]) => ({ id, type: "checkListItem", props: {}, content, children: [] });

function mountWith(document: unknown[]) {
  const updateBlock = vi.fn();
  const editor = { document, onChange: () => {}, updateBlock } as unknown as DocEditorInstance;
  let hook: ReturnType<typeof useRecordingEditor> | null = null;
  function Harness() {
    hook = useRecordingEditor({ notePath: "/documents/p1", projectId: "proj" });
    return null;
  }
  const root = createRoot(window.document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  hook!.onEditorReady(editor);
  return { hook: hook!, updateBlock, unmount: () => act(() => root.unmount()) };
}

describe("onTaskCreated", () => {
  it("links a short task to its line even though the line carries citation chips", () => {
    const { hook, updateBlock, unmount } = mountWith([checklist("a", text("Buy plates"), text(" "), chip(560, "Kaili · 9:20"))]);
    hook.hookProps.onTaskCreated("Buy plates", "t1", "proj");
    expect(updateBlock).toHaveBeenCalledTimes(1);
    expect(updateBlock.mock.calls[0]![0]).toBe("a");
    const content = updateBlock.mock.calls[0]![1].content as { type: string; props?: { label: string } }[];
    expect(content.at(-1)).toEqual({ type: "taskMention", props: { taskId: "t1", projectId: "proj", label: "Buy plates" } });
    unmount();
  });

  it("prefers the line that reads exactly like the task over a longer one containing it", () => {
    const { hook, updateBlock, unmount } = mountWith([
      checklist("long", text("Invite Pape to the team social and the demo"), text(" "), chip(1180, "Cole · 19:40")),
      checklist("exact", text("Invite Pape to the team social"), text(" "), chip(1180, "Cole · 19:40")),
    ]);
    hook.hookProps.onTaskCreated("Invite Pape to the team social", "t2", "proj");
    expect(updateBlock.mock.calls[0]![0]).toBe("exact");
    unmount();
  });
});
