// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectPartnerToPortal: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/fileAccess.server", () => ({ canViewFile: vi.fn(), canEditFile: vi.fn(), canManageFileSharing: vi.fn() }));
vi.mock("~/lib/s3.server", () => ({ getDownloadUrl: vi.fn() }));
vi.mock("~/lib/collabAuth.server", () => ({ hydrateAuthors: vi.fn() }));
vi.mock("~/drive/lib/drive-crumbs.server", () => ({ driveFolderCrumbs: vi.fn() }));
vi.mock("~/lib/upload-client", () => ({ formatBytes: (n: number) => `${Math.round(n / 1024)} KB`, uploadFileToS3: vi.fn() }));
vi.mock("~/components/collab/CommentsRail", () => ({ CommentsRail: () => null }));
vi.mock("~/components/FilePreview", () => ({ FilePreview: () => null }));
vi.mock("~/components/TagPicker", () => ({ TagPicker: () => null }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));

const { default: FilePage } = await import("../documents.file.$fileId");
const { PageBarSlotProvider, usePageBarTargetSetters } = await import("~/components/shell/page-bar-slot");
const { OverflowMenu } = await import("~/components/shell/OverflowMenu");
const { PageBarTrail } = await import("~/components/Breadcrumbs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Bar() {
  const { statusRef, actionsRef } = usePageBarTargetSetters();
  return createElement(
    "header",
    null,
    createElement(PageBarTrail, { crumbs }),
    createElement("div", { "data-testid": "status", ref: statusRef }),
    createElement("div", { "data-testid": "actions", ref: actionsRef }),
    createElement(OverflowMenu),
  );
}


const crumbs = [{ label: "Drive", to: "/drive" }, { label: "Budget", icon: createElement("span", { "data-testid": "glyph" }, "G") }];
const typeName = async (value: string) => {
  const input = document.body.querySelector<HTMLInputElement>("input[aria-label='Page name']")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
};
const originalFetch = globalThis.fetch;
function mockFetch() {
  const fn = vi.fn(async () => new Response("{}"));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}
const bodies = (fn: ReturnType<typeof mockFetch>, url: string) =>
  (fn.mock.calls as unknown as [string, RequestInit][]).filter(([u]) => u === url).map(([, i]) => JSON.parse(i.body as string));

const data = (canEdit: boolean, canShare = false) => ({
  fileId: "f1",
  projectId: null,
  title: "Budget.pdf",
  tags: [],
  allTags: [],
  canEdit,
  canShare,
  canManageTags: false,
  currentUserId: "u1",
  versions: [
    { id: "v2", label: "V2", fileName: "Budget.pdf", sizeBytes: 49152, uploadedBy: "Ada", createdAt: "2026-11-05T15:00:00.000Z", isCurrent: true, contentType: "application/pdf", downloadUrl: "/api/files/f1/download?version=v2", previewUrl: "/p2" },
    { id: "v1", label: "V1", fileName: "Budget.pdf", sizeBytes: 1024, uploadedBy: "Ada", createdAt: "2026-11-04T15:00:00.000Z", isCurrent: false, contentType: "application/pdf", downloadUrl: "/api/files/f1/download?version=v1", previewUrl: "/p1" },
  ],
});

async function mount(canEdit: boolean, canShare = false) {
  const Stub = createRoutesStub([
    {
      path: "/documents/file/:fileId",
      loader: () => data(canEdit, canShare),
      Component: () =>
        createElement(PageBarSlotProvider, { children: createElement("div", null, createElement(Bar), createElement(FilePage)) }),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/documents/file/f1"] }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("uploaded file page", () => {
  it("has no in-page title and shows the version and size as status", async () => {
    await mount(true);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("[data-testid=status]")!.textContent).toBe("v2 · 48 KB");
  });

  it("puts Download in the actions slot, pointing at the shown version", async () => {
    await mount(true);
    const link = container.querySelector<HTMLAnchorElement>("[data-testid=actions] a")!;
    expect(link.textContent).toBe("Download");
    expect(link.getAttribute("href")).toBe("/api/files/f1/download?version=v2");
  });

  it("shows the standard Share button before Download for someone who can manage sharing", async () => {
    await mount(true, true);
    const actions = container.querySelector("[data-testid=actions]")!;
    const share = actions.querySelector<HTMLElement>("button[aria-label='Share']")!;
    expect(share).not.toBeNull();
    expect(share.compareDocumentPosition(actions.querySelector("a")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the file share dialog from the Share button", async () => {
    const fetchMock = mockFetch();
    await mount(true, true);
    await act(async () => container.querySelector<HTMLElement>("button[aria-label='Share']")!.click());
    const urls = (fetchMock.mock.calls as unknown as [string][]).map(([u]) => u);
    expect(urls).toContain("/api/files/f1/share");
    expect(document.body.textContent).toContain("Share “Budget.pdf”");
  });

  it("hides Share from someone who cannot manage sharing, even an editor", async () => {
    await mount(true, false);
    expect(container.querySelector("button[aria-label='Share']")).toBeNull();
    expect(container.querySelector("[data-testid=actions] a")).not.toBeNull();
  });

  it("moves Upload new version into the overflow for editors only", async () => {
    await mount(true);
    expect(container.textContent).not.toContain("Upload new version");
    await act(async () => container.querySelector<HTMLElement>("[aria-label='More actions']")!.click());
    expect([...document.body.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(["Upload new version"]);
  });

  it("has no overflow for a viewer", async () => {
    await mount(false);
    expect(container.querySelector("[aria-label='More actions']")).toBeNull();
  });
});

describe("uploaded file title crumb", () => {
  it("renames with the /api/files/:id rename intent on Enter", async () => {
    const fetchMock = mockFetch();
    await mount(true);
    await act(async () => container.querySelector<HTMLElement>("button[aria-label='Rename']")!.click());
    await typeName("Budget v2.pdf");
    expect(bodies(fetchMock, "/api/files/f1")).toEqual([{ intent: "rename", title: "Budget v2.pdf" }]);
  });

  it("has no icon picker, since files carry no emoji", async () => {
    await mount(true);
    expect(container.querySelector("[data-testid=glyph]")!.closest("button")).toBeNull();
  });

  it("keeps a static crumb for a viewer", async () => {
    await mount(false);
    expect(container.querySelector("button[aria-label='Rename']")).toBeNull();
  });
});
