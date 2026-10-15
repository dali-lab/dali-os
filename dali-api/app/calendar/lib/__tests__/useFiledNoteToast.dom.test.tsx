// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FiledNote } from "~/calendar/lib/filed-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));
const navigate = vi.fn();
const revalidate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
  useRevalidator: () => ({ revalidate }),
}));
const undoFiledNote = vi.fn();
vi.mock("~/calendar/lib/filed-note", async (importActual) => ({
  ...(await importActual<typeof import("~/calendar/lib/filed-note")>()),
  undoFiledNote: (...args: unknown[]) => undoFiledNote(...args),
}));

const { useFiledNoteToast } = await import("~/calendar/lib/useFiledNoteToast");

const filed = (over: Partial<FiledNote> = {}): FiledNote => ({
  notePageId: "n1",
  notebookId: "nb1",
  createdNotebook: false,
  notePath: { label: "Projects ▸ Atlas ▸ Meetings ▸ Weekly sync", href: "/documents/n1" },
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

const actionsOf = () => (toast.success.mock.calls[0]![1] as { actions: { label: string; onClick: () => void }[] }).actions;
const flush = () => act(async () => {});

describe("useFiledNoteToast", () => {
  beforeEach(() => {
    navigate.mockClear();
    revalidate.mockClear();
    undoFiledNote.mockReset();
  });

  it("says which notebook and space the note went to", () => {
    show(filed());
    expect(toast.success).toHaveBeenCalledWith("Note filed in Weekly sync · Atlas", expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("offers Open, and Undo only when asked", () => {
    show(filed(), { undo: true });
    expect(actionsOf().map((a) => a.label)).toEqual(["Open", "Undo"]);
    toast.success.mockClear();
    show(filed());
    expect(actionsOf().map((a) => a.label)).toEqual(["Open"]);
    toast.success.mockClear();
    show(filed(), { open: false });
    expect(actionsOf()).toEqual([]);
  });

  it("opens the note", () => {
    show(filed());
    actionsOf()[0]!.onClick();
    expect(navigate).toHaveBeenCalledWith("/documents/n1");
  });

  it("reports the notebook removed with the note when undo trashed it", async () => {
    undoFiledNote.mockResolvedValue({ ok: true, notebookTrashed: true });
    show(filed({ createdNotebook: true }), { undo: true });
    actionsOf()[1]!.onClick();
    await flush();
    expect(toast.success).toHaveBeenLastCalledWith("Note and its empty notebook removed");
    expect(revalidate).toHaveBeenCalled();
  });

  it("reports only the note removed when the notebook stays", async () => {
    undoFiledNote.mockResolvedValue({ ok: true, notebookTrashed: false });
    show(filed(), { undo: true });
    actionsOf()[1]!.onClick();
    await flush();
    expect(toast.success).toHaveBeenLastCalledWith("Note removed");
  });

  it("says so when undo fails", async () => {
    undoFiledNote.mockResolvedValue({ ok: false, notebookTrashed: false });
    show(filed(), { undo: true });
    actionsOf()[1]!.onClick();
    await flush();
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo. The note is still filed.");
    expect(revalidate).not.toHaveBeenCalled();
  });
});
