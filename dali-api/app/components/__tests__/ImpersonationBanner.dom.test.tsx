// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ImpersonationBanner } from "~/components/ImpersonationBanner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(allowsWrites = false) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ImpersonationBanner userName="Maya Alvarez" allowsWrites={allowsWrites} />));
  return { container, unmount: () => act(() => root.unmount()) };
}

describe("ImpersonationBanner", () => {
  it("wears the os warning amber, not raw Tailwind amber", () => {
    const { container, unmount } = render();
    const banner = container.firstElementChild!;
    expect(banner.className).toContain("bg-os-amber/10");
    expect(banner.className).toContain("text-os-amber");
    expect(banner.className).not.toMatch(/amber-\d/);
    unmount();
  });

  it("names the member and says writes are recorded against the admin", () => {
    const { container, unmount } = render();
    expect(container.textContent).toContain("Maya Alvarez");
    expect(container.textContent).toContain("recorded against your admin account");
    unmount();
  });

  it("says actions go through on staging when writes are allowed", () => {
    const { container, unmount } = render(true);
    expect(container.textContent).toContain("Actions go through as them on staging");
    unmount();
  });
});
