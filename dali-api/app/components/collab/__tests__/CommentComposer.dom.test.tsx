// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentComposer } from "../CommentComposer";
import type { BodySegment } from "~/lib/comment-body";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ users: [], members: [] })));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function save(value: string, mentions?: BodySegment[]) {
  const onSubmit = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CommentComposer currentUserId="u1" value={value} onChange={() => {}} onSubmit={onSubmit} mentions={mentions} submitLabel="Save" />));
  act(() => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return onSubmit;
}

describe("CommentComposer saving an edit", () => {
  it("sends the chips already on the comment", () => {
    const onSubmit = save("hi @ada", [{ type: "text", text: "hi " }, { type: "mention", userId: "u3", label: "ada" }]);
    expect(onSubmit).toHaveBeenCalledWith([{ type: "text", text: "hi " }, { type: "mention", userId: "u3", label: "ada" }]);
  });
  it("sends plain text when the comment had no chips", () => {
    expect(save("hi @ada")).toHaveBeenCalledWith([{ type: "text", text: "hi " }, { type: "text", text: "@ada" }]);
  });
});
