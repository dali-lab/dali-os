// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn(), redirectPartnerToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({ receiversEnabled: vi.fn() }));
vi.mock("~/lib/drive-scopes.server", () => ({ loadDriveScopes: vi.fn() }));
vi.mock("~/lib/drive-home.server", () => ({ loadDriveHome: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({ formsUsePageAccess: vi.fn() }));
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
      items: [item("folder", "f1", null), item("doc", "d1", "f1")],
    },
  ],
  allTags: [],
  itemTagIds: {},
  terms: [],
  selectedTerm: null,
  canViewForms: false,
  formsPageAccess: null,
  canManageAgreements: false,
  receiversEnabled: false,
  homeEnabled: true,
  home: { recent: [{ ...item("doc", "d1", "f1"), visitedAt: at }], upcoming: [] },
  viewerId: "u1",
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

async function mountHub(url: string, data: Partial<typeof loaderData> = {}) {
  const Stub = createRoutesStub([
    { path: "/drive", Component: DriveHub, loader: () => ({ ...loaderData, ...data }) },
    { path: "/hiring/library", Component: DriveHub, loader: () => ({ ...loaderData, ...data }) },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(DialogProvider, null, createElement(ToastProvider, null, createElement(Stub, { initialEntries: [url] }))),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const home = () => container!.querySelector('[data-testid="drive-home"]');

describe("DriveHub home rows", () => {
  it("shows them at the Drive root, as their own card above the browser", async () => {
    await mountHub("/drive");
    const card = home()!;
    expect(card).not.toBeNull();
    expect(card.className).toContain("rounded-os-card");
    expect(card.className).toContain("bg-os-card");
    const browser = container!.querySelector('[data-testid="drive-columns"], [data-testid="drive-list-pane"]')!;
    expect(browser.contains(card)).toBe(false);
    expect(card.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps them above the browser while a drive is open", async () => {
    await mountHub("/drive?scope=lab");
    expect(home()).not.toBeNull();
  });

  it("keeps them while browsing inside a folder", async () => {
    await mountHub("/drive?scope=lab&folder=f1");
    expect(home()).not.toBeNull();
    expect(container!.querySelector('[data-testid="drive-home-recent"]')).not.toBeNull();
  });

  it("hides them while searching", async () => {
    await mountHub("/drive?scope=lab&folder=f1");
    const input = container!.querySelector<HTMLInputElement>('[data-testid="drive-search"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "plans");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(home()).toBeNull();
  });

  it("hides them in the Hiring Library", async () => {
    await mountHub("/hiring/library");
    expect(home()).toBeNull();
  });

  it("hides them when the flag is off", async () => {
    await mountHub("/drive?scope=lab&folder=f1", { homeEnabled: false, home: null as never });
    expect(home()).toBeNull();
  });
});
