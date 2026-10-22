// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router", () => ({
  Link: "a",
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn(), Form: "form" }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

const { WeekGridEvent } = await import("~/calendar/components/WeekGrid");
type Block = Parameters<typeof WeekGridEvent>[0]["e"];

let container: HTMLDivElement;
let root: Root;
const onMoveResize = vi.fn();

const pointer = (target: EventTarget, type: string, clientY: number) =>
  act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY, clientX: 0, button: 0 }));
  });

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return (this as HTMLElement).parentElement;
    },
  });
  onMoveResize.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const e: Block = { startHour: 10, duration: 1, label: "Standup", className: "bg-os-accent", onMoveResize };
  await act(async () => root.render(createElement(StrictMode, null, createElement("div", null, createElement(WeekGridEvent, { e })))));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
});

describe("WeekGridEvent drag", () => {
  it("reports a resize once, even under StrictMode", async () => {
    const handle = container.querySelector("[aria-label='Adjust end time']")!;
    await pointer(handle, "pointerdown", 0);
    await pointer(window, "pointermove", 54 * 12);
    await pointer(window, "pointerup", 54 * 12);
    expect(onMoveResize).toHaveBeenCalledTimes(1);
    expect(onMoveResize).toHaveBeenCalledWith(10, 12);
  });

  it("reports a body move once, even under StrictMode", async () => {
    const body = container.querySelector("[role='button']")!;
    await pointer(body, "pointerdown", 54 * 10);
    await pointer(window, "pointermove", 54 * 12);
    await pointer(window, "pointerup", 54 * 12);
    expect(onMoveResize).toHaveBeenCalledTimes(1);
    expect(onMoveResize.mock.calls[0]![0]).toBe(12);
  });

  it("reports nothing when the pointer is released without moving", async () => {
    const body = container.querySelector("[role='button']")!;
    await pointer(body, "pointerdown", 54 * 10);
    await pointer(window, "pointerup", 54 * 10);
    expect(onMoveResize).not.toHaveBeenCalled();
  });
});
