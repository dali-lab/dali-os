// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Select: () => null,
}));
vi.mock("~/components/os-chrome", () => ({ useOsChrome: () => ({ iconBtn: "" }), modalCardClass: () => "" }));
vi.mock("~/components/Modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? children : null),
  ModalHeader: ({ subtitle }: { subtitle?: string }) => createElement("p", { "data-testid": "subtitle" }, subtitle),
}));

import { VersionResults } from "~/forms/components/VersionResults";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { DialogProvider } from "~/components/ui/dialog";

let root: Root;
let container: HTMLDivElement;

const response = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  createdAt: "2026-05-20T10:00:00.000Z",
  edited: false,
  lockReason: null,
  name: "Ada",
  email: "ada@example.edu",
  slot: null,
  submitterIp: null,
  partnerApplication: null,
  rows: [],
  ...over,
});

async function open(flagOn: boolean, over: Record<string, unknown> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const data = {
    versionId: "v1",
    isPartnerApplicationForm: false,
    totalCount: 1,
    matchCount: 1,
    page: 1,
    hasNext: false,
    columns: [],
    slotOptions: [],
    responses: [response(over)],
  };
  const router = createMemoryRouter(
    [
      {
        path: "/forms/edit/f1",
        action: () => null,
        element: createElement(
          FeatureFlagsProvider,
          { flags: { "form-upgrades": flagOn } },
          createElement(
            DialogProvider,
            null,
            createElement(VersionResults, { formId: "f1", versionNumber: 1, results: data as never }),
          ),
        ),
      },
    ],
    { initialEntries: ["/forms/edit/f1"] },
  );
  await act(async () => root.render(createElement(RouterProvider, { router })));
  await act(async () => container.querySelector("tbody tr")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("VersionResults delete and edited marker", () => {
  it("offers Delete response in the detail when the flag is on", async () => {
    await open(true);
    expect(container.textContent).toContain("Delete response");
    expect(container.querySelector<HTMLInputElement>('input[name="intent"]')!.value).toBe("delete-form-response");
    expect(container.querySelector<HTMLInputElement>('input[name="submissionId"]')!.value).toBe("s1");
  });

  it("offers nothing to delete when the flag is off", async () => {
    await open(false);
    expect(container.textContent).not.toContain("Delete response");
  });

  it("shows why instead of a button when the response feeds something else", async () => {
    await open(true, { lockReason: "Linked to an application or survey." });
    expect(container.textContent).toContain("This response can't be deleted. Linked to an application or survey.");
    expect(container.textContent).not.toContain("Delete response");
  });

  it("marks an edited response in the table and the detail", async () => {
    await open(true, { edited: true });
    expect(container.querySelector("td")!.parentElement!.textContent).toContain("Edited");
    expect(container.querySelector('[data-testid="subtitle"]')!.textContent).toContain("Edited");
  });

  it("shows no marker on an untouched response", async () => {
    await open(true);
    expect(container.querySelector("tbody tr")!.textContent).not.toContain("Edited");
  });
});
