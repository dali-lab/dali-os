// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const fetchers = vi.hoisted(() => ({
  post: { state: "idle", data: undefined as { ok: boolean } | undefined, submit: vi.fn() },
  remove: { state: "idle", data: undefined, submit: vi.fn() },
  calls: 0,
}));
const confirm = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({
  useFetcher: () => (fetchers.calls++ % 2 === 0 ? fetchers.post : fetchers.remove),
}));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => stableToast }));
vi.mock("~/components/MentionTextInput", () => ({
  MentionTextInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Add a comment" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { PostComments, type PostComment } from "../PostComments";

const stableToast = { error: toastError };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const comment = (over: Partial<PostComment> = {}): PostComment => ({
  id: "c1",
  body: "ping @ada please",
  createdAt: "2026-03-01T00:00:00Z",
  author: { name: "Grace Hopper", photoUrl: null },
  canDelete: true,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn();
  fetchers.calls = 0;
  fetchers.post.data = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const deleteButton = () =>
  container.querySelector('button[aria-label="Delete comment"]') as HTMLButtonElement | null;

function type(value: string) {
  const input = container.querySelector("input") as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PostComments", () => {
  const ui = (comments = [comment()]) => (
    <PostComments postId="p1" comments={comments} maxLength={1000} />
  );

  it("sets off mentions in a comment body", () => {
    render(ui());
    expect(container.querySelector("span.text-os-accent")?.textContent).toBe("@ada");
  });

  it("deletes only after a destructive confirm", async () => {
    confirm.mockResolvedValue(true);
    render(ui());
    await act(async () => deleteButton()!.click());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: "destructive" }));
    expect(fetchers.remove.submit).toHaveBeenCalledWith(
      { intent: "delete-comment", commentId: "c1" },
      { method: "post" },
    );
  });

  it("leaves the comment alone when the confirm is cancelled", async () => {
    confirm.mockResolvedValue(false);
    render(ui());
    await act(async () => deleteButton()!.click());
    expect(fetchers.remove.submit).not.toHaveBeenCalled();
  });

  it("offers delete only on comments the viewer can delete", () => {
    render(ui([comment({ canDelete: false })]));
    expect(deleteButton()).toBeNull();
  });

  it("clears the draft after a successful post", () => {
    render(ui());
    type("hello");
    fetchers.post.data = { ok: true };
    render(ui());
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("keeps the draft and says so when the post fails", () => {
    render(ui());
    type("hello");
    fetchers.post.data = { ok: false };
    render(ui());
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("hello");
    expect(toastError).toHaveBeenCalledWith("Could not post your comment");
  });

  it("has a count header and empty line only when filling a panel", () => {
    render(<PostComments postId="p1" comments={[]} maxLength={1000} fill />);
    expect(container.textContent).toContain("No comments yet.");
    render(<PostComments postId="p1" comments={[comment()]} maxLength={1000} fill />);
    expect(container.textContent).toContain("1 comment");
    render(<PostComments postId="p1" comments={[]} maxLength={1000} />);
    expect(container.textContent).not.toContain("No comments yet.");
  });
});
