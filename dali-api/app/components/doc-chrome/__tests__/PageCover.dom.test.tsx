// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("~/components/doc", () => ({ uploadEditorImage: vi.fn(), IMAGE_UPLOAD_ACCEPT: "image/*" }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ info: vi.fn() }) }));

import { PageCover } from "~/components/doc-chrome/PageCover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(props: { coverImageUrl: string | null; canEdit?: boolean }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(PageCover, { onChange: vi.fn(), ...props })));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PageCover", () => {
  it("renders nothing without edit access or a cover", async () => {
    await mount({ coverImageUrl: null, canEdit: false });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when canEdit is omitted", async () => {
    await mount({ coverImageUrl: null });
    expect(container.innerHTML).toBe("");
  });

  it("shows the add cover button when editable", async () => {
    await mount({ coverImageUrl: null, canEdit: true });
    expect(container.textContent).toContain("Add cover");
  });

  it("hides change and remove controls when read-only", async () => {
    await mount({ coverImageUrl: "/cover.png", canEdit: false });
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.textContent).not.toContain("Remove");
  });
});
