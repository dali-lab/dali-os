// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DialogProvider } from "~/components/ui/dialog";

vi.mock("~/partners/lib/partner-detail-fetch", () => ({ postPartnerApplicationIntent: vi.fn() }));

import { postPartnerApplicationIntent } from "~/partners/lib/partner-detail-fetch";
import { DeleteApplicationButton } from "../DeleteApplicationButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onDeleted = vi.fn();

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        DialogProvider,
        null,
        createElement(DeleteApplicationButton, { applicationId: "a1", title: "Oops duplicate", onDeleted }),
      ),
    ),
  );
}

const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
const byLabel = (label: string) => buttons().find((b) => b.getAttribute("aria-label") === label);
const byText = (text: string) => buttons().find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DeleteApplicationButton", () => {
  it("asks before deleting and names the application", async () => {
    await mount();
    await act(async () => byLabel("Delete application")!.click());
    expect(document.body.textContent).toContain("Delete “Oops duplicate”?");
    expect(postPartnerApplicationIntent).not.toHaveBeenCalled();
  });

  it("does nothing when the confirm is cancelled", async () => {
    await mount();
    await act(async () => byLabel("Delete application")!.click());
    await act(async () => byText("Cancel")!.click());
    expect(postPartnerApplicationIntent).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("posts the delete intent and reports success", async () => {
    vi.mocked(postPartnerApplicationIntent).mockResolvedValue({ ok: true });
    await mount();
    await act(async () => byLabel("Delete application")!.click());
    await act(async () => byText("Delete application")!.click());
    expect(postPartnerApplicationIntent).toHaveBeenCalledWith("a1", "delete");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open with the server's reason when the delete is refused", async () => {
    vi.mocked(postPartnerApplicationIntent).mockResolvedValue({
      ok: false,
      error: "This application became a project, so it can't be deleted.",
    });
    await mount();
    await act(async () => byLabel("Delete application")!.click());
    await act(async () => byText("Delete application")!.click());
    expect(document.body.textContent).toContain("This application became a project, so it can't be deleted.");
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
