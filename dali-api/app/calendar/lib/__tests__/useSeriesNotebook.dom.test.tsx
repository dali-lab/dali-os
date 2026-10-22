// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const confirm = vi.fn();
const choice = vi.fn();
const revalidate = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };
const setSeriesNotebookRequest = vi.fn();

vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm, choice }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate }) }));
vi.mock("~/calendar/lib/series-notebook", async (orig) => ({
  ...(await orig<typeof import("~/calendar/lib/series-notebook")>()),
  setSeriesNotebookRequest: (...args: unknown[]) => setSeriesNotebookRequest(...args),
}));

import { useSeriesNotebook } from "~/calendar/lib/useSeriesNotebook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useSeriesNotebook>;

function Probe() {
  api = useSeriesNotebook();
  return null;
}

const NOTEBOOK = { id: "nb2", title: "Retro" };

beforeEach(async () => {
  vi.clearAllMocks();
  setSeriesNotebookRequest.mockResolvedValue({ ok: true, skipped: 0 });
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
});

afterEach(() => act(() => root.unmount()));

describe("useSeriesNotebook changeNotebook", () => {
  it("asks one plain question for a one-off and moves everything", async () => {
    confirm.mockResolvedValue(true);

    await act(async () => api.changeNotebook("m1", NOTEBOOK, { recurring: false }));

    expect(choice).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith({
      title: "Move this note to Retro?",
      description: "Its notes move into that notebook.",
      confirmLabel: "Move",
    });
    expect(setSeriesNotebookRequest).toHaveBeenCalledWith("m1", "nb2", "all");
  });

  it("changes nothing when the one-off move is declined", async () => {
    confirm.mockResolvedValue(false);

    await act(async () => api.changeNotebook("m1", NOTEBOOK, { recurring: false }));

    expect(setSeriesNotebookRequest).not.toHaveBeenCalled();
  });

  it.each(["future", "all"] as const)("still offers the chooser for a series and applies %s", async (scope) => {
    choice.mockResolvedValue(scope);

    await act(async () => api.changeNotebook("m1", NOTEBOOK, { recurring: true }));

    expect(confirm).not.toHaveBeenCalled();
    expect(choice).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          expect.objectContaining({ value: "future", label: "Future meetings only" }),
          expect.objectContaining({ value: "all", label: "All meetings" }),
        ],
      }),
    );
    expect(setSeriesNotebookRequest).toHaveBeenCalledWith("m1", "nb2", scope);
  });

  it("changes nothing when the chooser is dismissed", async () => {
    choice.mockResolvedValue(null);

    await act(async () => api.changeNotebook("m1", NOTEBOOK, { recurring: true }));

    expect(setSeriesNotebookRequest).not.toHaveBeenCalled();
  });
});

describe("useSeriesNotebook apply", () => {
  it("sets the series notebook for the scope and reports it", async () => {
    await act(async () => api.apply("m1", "nb2", "future"));
    expect(setSeriesNotebookRequest).toHaveBeenCalledWith("m1", "nb2", "future");
    expect(toast.success).toHaveBeenCalledWith("Notebook updated");
    expect(revalidate).toHaveBeenCalled();
  });
});

describe("useSeriesNotebook shownNotebook", () => {
  const loaded = { id: "nb1", title: "Standups" };

  it("shows a newly picked notebook until the loader has refreshed", async () => {
    let finish!: () => void;
    revalidate.mockReturnValue(new Promise<void>((r) => (finish = r)));
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = api.apply("m1", "nb2", "future", { notebook: NOTEBOOK });
    });
    expect(api.shownNotebook("m1", loaded)).toEqual(NOTEBOOK);
    expect(api.shownNotebook("other", loaded)).toEqual(loaded);

    await act(async () => {
      finish();
      await pending;
    });
    expect(api.shownNotebook("m1", loaded)).toEqual(loaded);
  });

  it("shows none while an unset is going out", async () => {
    setSeriesNotebookRequest.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      void api.apply("m1", null, "future", { notebook: null });
    });
    expect(api.shownNotebook("m1", loaded)).toBeNull();
  });

  it("goes back to the loader's notebook when the change fails", async () => {
    setSeriesNotebookRequest.mockResolvedValue({ ok: false, error: "Nope" });
    await act(async () => api.apply("m1", "nb2", "future", { notebook: NOTEBOOK }));
    expect(api.shownNotebook("m1", loaded)).toEqual(loaded);
    expect(toast.error).toHaveBeenCalledWith("Nope");
  });

  it("goes back to the loader's notebook when the request throws", async () => {
    setSeriesNotebookRequest.mockRejectedValue(new Error("Network error"));
    await act(async () => {
      await api.apply("m1", "nb2", "future", { notebook: NOTEBOOK }).catch(() => {});
    });
    expect(api.shownNotebook("m1", loaded)).toEqual(loaded);
  });

  it("goes back to the loader's notebook when the revalidation throws", async () => {
    setSeriesNotebookRequest.mockResolvedValue({ ok: true, skipped: 0 });
    revalidate.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await api.apply("m1", "nb2", "future", { notebook: NOTEBOOK }).catch(() => {});
    });
    expect(api.shownNotebook("m1", loaded)).toEqual(loaded);
  });
});
