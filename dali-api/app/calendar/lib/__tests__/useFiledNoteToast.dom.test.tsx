// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FiledNote } from "~/calendar/lib/filed-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useRevalidator: () => ({ revalidate: vi.fn() }),
}));

const { useFiledNoteToast } = await import("~/calendar/lib/useFiledNoteToast");

const filed = (over: Partial<FiledNote> = {}): FiledNote => ({
  notePageId: "n1",
  notebookId: "nb1",
  createdNotebook: false,
  notePath: { label: "Core ▸ Meetings", href: "/documents/n1" },
  ...over,
});

let container: HTMLDivElement;
let root: Root;
let show: ReturnType<typeof useFiledNoteToast>;

function Probe() {
  show = useFiledNoteToast();
  return null;
}

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Probe)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useFiledNoteToast", () => {
  it("says where the note was filed", () => {
    show(filed());
    expect(toast.success).toHaveBeenCalledWith("Filed to Core ▸ Meetings", expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
