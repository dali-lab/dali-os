// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OverflowMenu } from "~/components/shell/OverflowMenu";
import { PageBarMenuItems, PageBarSlotProvider } from "~/components/shell/page-bar-slot";
import { Menu } from "~/components/ui/floating";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<PageBarSlotProvider>{node}</PageBarSlotProvider>));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const trigger = () => container.querySelector("[aria-label='More actions']");

describe("OverflowMenu", () => {
  it("renders nothing when it has no entries", () => {
    mount(<OverflowMenu />);
    expect(trigger()).toBeNull();
  });

  it("shows for shell entries alone", () => {
    mount(<OverflowMenu shellItems={<Menu.Item>Copy link</Menu.Item>} />);
    expect(trigger()).not.toBeNull();
  });

  it("shows once a page registers entries", () => {
    mount(
      <>
        <PageBarMenuItems>
          <Menu.Item>Download PDF</Menu.Item>
        </PageBarMenuItems>
        <OverflowMenu />
      </>,
    );
    expect(trigger()).not.toBeNull();
  });
});
