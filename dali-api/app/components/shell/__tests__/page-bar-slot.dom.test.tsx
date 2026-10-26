// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  NoPageBar,
  PageBarPortal,
  PageBarSlotProvider,
  SHELL_HEADER_VAR,
  usePageBarSlot,
  usePageBarTargetSetters,
  useShellHeaderHeight,
} from "~/components/shell/page-bar-slot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
}

let unmounted = false;

function rootUnmount() {
  root.unmount();
  unmounted = true;
}

afterEach(() => {
  if (!unmounted) act(() => root.unmount());
  unmounted = false;
  container.remove();
});

function Bar() {
  const { actionsRef, presenceRef } = usePageBarTargetSetters();
  return (
    <div id="bar">
      <div id="actions" ref={actionsRef} />
      <div id="presence" ref={presenceRef} />
    </div>
  );
}

function Probe({ id }: { id: string }) {
  return <span data-probe={id}>{String(usePageBarSlot())}</span>;
}

describe("page bar slots", () => {
  it("portals children into the matching slot", async () => {
    await render(
      <PageBarSlotProvider>
        <Bar />
        <PageBarPortal slot="actions">
          <b>toolbar</b>
        </PageBarPortal>
        <PageBarPortal slot="presence">
          <i>avatars</i>
        </PageBarPortal>
      </PageBarSlotProvider>,
    );
    expect(container.querySelector("#actions")?.textContent).toBe("toolbar");
    expect(container.querySelector("#presence")?.textContent).toBe("avatars");
  });

  it("renders nothing until the bar's target exists", async () => {
    await render(
      <PageBarSlotProvider>
        <PageBarPortal slot="actions">
          <b>toolbar</b>
        </PageBarPortal>
      </PageBarSlotProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing outside a provider", async () => {
    await render(
      <PageBarPortal slot="actions">
        <b>toolbar</b>
      </PageBarPortal>,
    );
    expect(container.textContent).toBe("");
  });

  it("tells callers whether a page bar exists", async () => {
    await render(
      <div>
        <Probe id="none" />
        <PageBarSlotProvider>
          <Probe id="in" />
        </PageBarSlotProvider>
      </div>,
    );
    expect(container.querySelector("[data-probe='none']")?.textContent).toBe("false");
    expect(container.querySelector("[data-probe='in']")?.textContent).toBe("true");
  });

  it("NoPageBar puts descendants back to inline", async () => {
    await render(
      <PageBarSlotProvider>
        <Bar />
        <NoPageBar>
          <Probe id="panel" />
          <PageBarPortal slot="actions">
            <b>toolbar</b>
          </PageBarPortal>
        </NoPageBar>
      </PageBarSlotProvider>,
    );
    expect(container.querySelector("[data-probe='panel']")?.textContent).toBe("false");
    expect(container.querySelector("#actions")?.textContent).toBe("");
  });

  it("drops portaled content when the bar unmounts its target", async () => {
    function Host({ show }: { show: boolean }) {
      return (
        <PageBarSlotProvider>
          {show ? <Bar /> : null}
          <PageBarPortal slot="actions">
            <b>toolbar</b>
          </PageBarPortal>
        </PageBarSlotProvider>
      );
    }
    await render(<Host show />);
    expect(container.textContent).toBe("toolbar");
    await act(async () => {
      root.render(<Host show={false} />);
    });
    expect(container.textContent).toBe("");
  });
});

describe("useShellHeaderHeight", () => {
  function Header() {
    const ref = useShellHeaderHeight();
    return <div ref={ref} />;
  }

  it("publishes the header height, follows resizes, and clears it on unmount", async () => {
    let onResize: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          onResize = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    let height = 84;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);

    await render(<Header />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue(SHELL_HEADER_VAR)).toBe("84px");

    height = 44;
    act(() => onResize());
    expect(root.style.getPropertyValue(SHELL_HEADER_VAR)).toBe("44px");

    act(() => rootUnmount());
    expect(disconnect).toHaveBeenCalled();
    expect(root.style.getPropertyValue(SHELL_HEADER_VAR)).toBe("");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
