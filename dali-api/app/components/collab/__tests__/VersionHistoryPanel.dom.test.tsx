// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { VersionHistoryPanel } = await import("~/components/collab/VersionHistoryPanel");
const { ToastProvider } = await import("~/components/ui/toast");
const { DialogProvider } = await import("~/components/ui/dialog");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = { id: "v1", createdAt: new Date().toISOString(), label: null, plainTextPreview: "hi", authors: [] };
const detail = { ...item, plainText: "hi", html: "<p>hi</p>" };

let root: Root;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(canEdit: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(String(url).includes("/versions/v1") ? detail : [item]),
    ),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(
          DialogProvider,
          null,
          createElement(VersionHistoryPanel, { documentName: "doc:p1:body", canEdit, onClose: () => {} }),
        ),
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  const row = document.body.querySelector<HTMLElement>(".cursor-pointer");
  expect(row).not.toBeNull();
  await act(async () => {
    row?.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("VersionHistoryPanel edit controls", () => {
  it("hides naming and restore for read-only viewers", async () => {
    await render(false);
    expect(document.body.textContent).not.toContain("Restore this version");
    expect(document.body.querySelector('[aria-label="Name this version"]')).toBeNull();
  });

  it("shows naming and restore to editors", async () => {
    await render(true);
    expect(document.body.textContent).toContain("Restore this version");
    expect(document.body.querySelector('[aria-label="Name this version"]')).not.toBeNull();
  });
});
