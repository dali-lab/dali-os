// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prompt = vi.fn();
const toastError = vi.fn();
const submit = vi.fn();
let fetcher: { state: string; data: unknown };
vi.mock("react-router", () => ({ useFetcher: () => ({ ...fetcher, submit }) }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ prompt }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: toastError }) }));

const { AbsenceNoteButton } = await import("~/components/AbsenceNoteButton");

let container: HTMLDivElement;
let root: Root;
const onSaved = vi.fn();

const render = () =>
  act(async () =>
    root.render(
      createElement(AbsenceNoteButton, {
        meetingId: "m1",
        occurrenceStart: "2026-10-20T14:00:00.000Z",
        userId: "u1",
        name: "Alex",
        note: "flu",
        onSaved,
      }),
    ),
  );

beforeEach(async () => {
  fetcher = { state: "idle", data: undefined };
  prompt.mockReset().mockResolvedValue("class conflict");
  toastError.mockReset();
  submit.mockReset();
  onSaved.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AbsenceNoteButton", () => {
  it("shows the new note straight away", async () => {
    await act(async () => container.querySelector("button")!.click());
    expect(onSaved).toHaveBeenCalledWith("class conflict");
  });

  it("puts the old note back and says so when the save fails", async () => {
    await act(async () => container.querySelector("button")!.click());
    onSaved.mockClear();
    fetcher = { state: "submitting", data: undefined };
    await render();
    fetcher = { state: "idle", data: { error: "Forbidden" } };
    await render();
    expect(onSaved).toHaveBeenCalledWith("flu");
    expect(toastError).toHaveBeenCalledWith("Couldn't save the absence note.");
  });

  it("keeps the new note when the save goes through", async () => {
    await act(async () => container.querySelector("button")!.click());
    onSaved.mockClear();
    fetcher = { state: "submitting", data: undefined };
    await render();
    fetcher = { state: "idle", data: { ok: true } };
    await render();
    expect(onSaved).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
