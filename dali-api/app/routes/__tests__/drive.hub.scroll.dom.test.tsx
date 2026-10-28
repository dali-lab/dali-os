// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, Outlet, ScrollRestoration, useLocation } from "react-router";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn(), redirectPartnerToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/drive-scopes.server", () => ({ loadDriveScopes: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/drive-hub.server", () => ({
  loadProjectWorkspaces: vi.fn(),
  loadEducationWorkspaces: vi.fn(),
  loadAllDocTags: vi.fn(),
  loadItemTagIds: vi.fn(),
}));

import DriveHub from "~/routes/drive.hub";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date("2026-01-01T00:00:00Z");
const item = (type: "doc" | "folder", id: string, parentFolderId: string | null) => ({
  type,
  id,
  title: `${type} ${id}`,
  parentFolderId,
  iconEmoji: null,
  updatedAt: at,
  href: `/documents/${id}`,
});

const loaderData = {
  driveScopes: [
    {
      id: "lab",
      label: "Lab-wide",
      iconEmoji: null,
      rootFolderId: null,
      items: [item("folder", "f1", null), item("folder", "f2", "f1"), item("doc", "d1", "f2")],
    },
  ],
  allTags: [],
  itemTagIds: {},
  terms: [],
  selectedTerm: null,
  canManageAgreements: false,
  viewerId: "u1",
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let search = "";

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.restoreAllMocks();
});

function Shell() {
  search = useLocation().search;
  return createElement("div", null, createElement(Outlet), createElement(ScrollRestoration));
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mountHub(url: string) {
  const Stub = createRoutesStub([
    { Component: Shell, children: [{ path: "/drive", Component: DriveHub, loader: () => loaderData }] },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(DialogProvider, null, createElement(ToastProvider, null, createElement(Stub, { initialEntries: [url] }))),
    );
  });
  await settle();
}

async function click(testId: string) {
  const el = container!.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
  expect(el).not.toBeNull();
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

const scrolledToTop = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.some((args: unknown[]) => args[0] === 0 && args[1] === 0);

describe("DriveHub scroll position", () => {
  it("keeps the page where it was when opening a folder", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await mountHub("/drive?scope=lab");
    scrollTo.mockClear();

    await click("drive-item-folder-f1");

    expect(new URLSearchParams(search).get("folder")).toBe("f1");
    expect(scrolledToTop(scrollTo)).toBe(false);
  });

  it("keeps the page where it was when opening a nested folder", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await mountHub("/drive?scope=lab&folder=f1");
    scrollTo.mockClear();

    await click("drive-item-folder-f2");

    expect(new URLSearchParams(search).get("folder")).toBe("f2");
    expect(scrolledToTop(scrollTo)).toBe(false);
  });
});
