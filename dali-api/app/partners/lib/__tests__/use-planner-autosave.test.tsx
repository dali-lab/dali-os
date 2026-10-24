// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlannerAutosave } from "../use-planner-autosave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let cell: ReturnType<typeof usePlannerAutosave<string>>;
const save = vi.fn<(value: string) => Promise<void>>();
const error = vi.fn();
function Cell({ initial }: { initial: string }) {
  cell = usePlannerAutosave(initial, save, error);
  return createElement("span", null, cell.value);
}
async function render(initial = "") {
  await act(async () => root.render(createElement(Cell, { initial })));
}
beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset().mockResolvedValue(undefined);
  error.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("debounces and does not duplicate a successful save on blur", async () => {
  await render();
  await act(async () => { cell.change("draft"); await vi.advanceTimersByTimeAsync(500); });
  await act(async () => { await cell.flush(); });
  expect(save.mock.calls).toEqual([["draft"]]);
});
it("serializes writes and preserves newer typing through revalidation", async () => {
  let release!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  await render();
  await act(async () => { cell.change("first"); await vi.advanceTimersByTimeAsync(500); });
  await act(async () => { cell.change("latest"); await cell.flush(); });
  await render("first");
  expect(cell.value).toBe("latest");
  expect(save.mock.calls).toEqual([["first"]]);
  await act(async () => release());
  expect(save.mock.calls).toEqual([["first"], ["latest"]]);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); await cell.flush(); });
  expect(save).toHaveBeenCalledTimes(2);
});
it("flushes a pending edit when filtering, switching terms, or moving groups unmounts it", async () => {
  await render();
  await act(async () => cell.change("pending"));
  await act(async () => root.render(null));
  expect(save.mock.calls).toEqual([["pending"]]);
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(1);
});
it("retries a failed draft on blur", async () => {
  save.mockRejectedValueOnce(new Error("offline"));
  await render();
  await act(async () => { cell.change("retry"); await vi.advanceTimersByTimeAsync(500); });
  expect(error).toHaveBeenCalledTimes(1);
  expect(cell.value).toBe("retry");
  await act(async () => { await cell.flush(); });
  expect(save.mock.calls).toEqual([["retry"], ["retry"]]);
});
it("accepts external changes only while clean", async () => {
  await render("old");
  await render("remote");
  expect(cell.value).toBe("remote");
  await act(async () => cell.change("local"));
  await render("another remote");
  expect(cell.value).toBe("local");
});
it("saves a revert to the original value after an in-flight edit", async () => {
  let release!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  await render("original");
  await act(async () => { cell.change("edit"); await vi.advanceTimersByTimeAsync(500); });
  await act(async () => cell.change("original"));
  await act(async () => release());
  expect(save.mock.calls).toEqual([["edit"], ["original"]]);
});
