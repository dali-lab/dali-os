// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
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
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const { SelectionPopoverPortal } = await import("~/calendar/components/WeekGrid");

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SelectionPopoverPortal pointer targets", () => {
  // jsdom does no hit testing, so this pins the classes that decide it: a card
  // that steps aside with `invisible` (TimesheetEditPopover's delete confirm)
  // must leave nothing behind that covers the confirm's buttons.
  it("lets only the card take the pointer, never the positioning wrapper", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(SelectionPopoverPortal, {
          anchorEl: null,
          onDismiss: () => {},
          children: createElement("div", { className: "invisible", "data-testid": "card" }),
        }),
      ),
    );
    const wrapper = document.querySelector<HTMLElement>("[data-calendar-popover]")!;
    expect(wrapper.className.split(" ")).toContain("pointer-events-none");
    expect(wrapper.className.split(" ")).toContain("[&>*]:pointer-events-auto");
    expect(wrapper.querySelector("[data-testid='card']")).not.toBeNull();
  });
});
