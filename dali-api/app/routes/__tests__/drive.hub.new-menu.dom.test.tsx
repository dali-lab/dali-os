// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn(), redirectPartnerToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({ receiversEnabled: vi.fn() }));
vi.mock("~/lib/drive-scopes.server", () => ({ loadDriveScopes: vi.fn() }));
vi.mock("~/lib/drive-home.server", () => ({ loadDriveHome: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/drive-hub.server", () => ({
  loadProjectWorkspaces: vi.fn(),
  loadEducationWorkspaces: vi.fn(),
  loadAllDocTags: vi.fn(),
  loadItemTagIds: vi.fn(),
}));

const prompt = vi.fn();
const toastError = vi.fn();
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ prompt }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: toastError, success: vi.fn() }) }));

import { NewMenu, notebookPlacement } from "~/routes/drive.hub";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Scope = Parameters<typeof notebookPlacement>[0];

const scope = (over: { id: string; rootFolderId?: string | null; items?: unknown[] }): Scope =>
  ({ label: over.id, iconEmoji: null, items: [], rootFolderId: null, ...over }) as unknown as Scope;

const node = (id: string, parentFolderId: string | null) => ({ id, parentFolderId, type: "doc" });

const projectsGroup = scope({ id: "projects", items: [node("proj-1", null), node("sub", "proj-1")] });

let container: HTMLDivElement | undefined;
let root: Root | undefined;
const assign = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  prompt.mockReset();
  toastError.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { assign } });
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  vi.unstubAllGlobals();
});

async function mountMenu(s: Scope, currentFolderId: string | null = null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      createElement(NewMenu, {
        scope: s,
        actions: {} as never,
        canViewForms: false,
        canManageAgreements: false,
        onUploadClick: () => {},
        uploading: false,
        onTemplate: () => {},
        currentFolderId,
      }),
    );
  });
  await act(async () => {
    document.querySelector<HTMLElement>(`[data-testid="drive-new-menu-${s.id}"]`)!.click();
  });
}

const notebookItem = (id: string) => document.querySelector<HTMLElement>(`[data-testid="drive-new-notebook-${id}"]`);

async function choose(id: string) {
  await act(async () => {
    notebookItem(id)!.closest<HTMLElement>('[role="menuitem"]')!.click();
  });
}

describe("notebookPlacement", () => {
  it("places a lab notebook in the lab workspace at the top level", () => {
    expect(notebookPlacement(scope({ id: "lab" }), null)).toEqual({
      kind: "ready",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
    });
  });

  it("nests a Core notebook under the Core root folder, or the open folder", () => {
    const core = scope({ id: "core", rootFolderId: "core-root" });
    expect(notebookPlacement(core, null)).toMatchObject({ workspaceType: "Lab", parentPageId: "core-root" });
    expect(notebookPlacement(core, "f1")).toMatchObject({ workspaceType: "Lab", parentPageId: "f1" });
  });

  it("places a project notebook in that project", () => {
    expect(notebookPlacement(scope({ id: "p1" }), "f1")).toEqual({
      kind: "ready",
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: "f1",
    });
  });

  it("resolves the project from the open folder inside the Projects group", () => {
    expect(notebookPlacement(projectsGroup, "proj-1")).toEqual({
      kind: "ready",
      workspaceType: "Project",
      workspaceId: "proj-1",
      parentPageId: null,
    });
    expect(notebookPlacement(projectsGroup, "sub")).toMatchObject({ workspaceId: "proj-1", parentPageId: "sub" });
  });

  it("asks for a project at the Projects group root", () => {
    expect(notebookPlacement(projectsGroup, null)).toEqual({ kind: "blocked", reason: "Open a project first" });
  });

  it.each(["mine", "education"])("is unavailable in %s", (id) => {
    expect(notebookPlacement(scope({ id }), null)).toEqual({ kind: "unavailable" });
  });
});

describe("New menu: New notebook", () => {
  it.each(["lab", "core", "hiring", "mentorship", "p1"])("is offered in %s", async (id) => {
    await mountMenu(scope({ id }));
    expect(notebookItem(id)).not.toBeNull();
  });

  it.each(["mine", "education"])("is absent in %s", async (id) => {
    await mountMenu(scope({ id }));
    expect(document.querySelector(`[data-testid="drive-new-doc-${id}"]`)).not.toBeNull();
    expect(notebookItem(id)).toBeNull();
  });

  it("is disabled with a reason at the Projects group root", async () => {
    await mountMenu(projectsGroup, null);
    expect(notebookItem("projects")!.textContent).toContain("Open a project first");
    const item = notebookItem("projects")!.closest('[role="menuitem"]')!;
    expect(item.hasAttribute("disabled") || item.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("sits right after New whiteboard", async () => {
    await mountMenu(scope({ id: "lab" }));
    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent);
    expect(labels.indexOf("New notebook")).toBe(labels.indexOf("New whiteboard") + 1);
  });

  it("posts a lab notebook and opens it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "nb1" }) });
    vi.stubGlobal("fetch", fetchMock);
    prompt.mockResolvedValue("  Weekly  ");
    await mountMenu(scope({ id: "lab" }), "f1");
    await choose("lab");
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ title: "New notebook", defaultValue: "New notebook" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/notebooks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      title: "Weekly",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "f1",
      templatePageId: null,
    });
    expect(assign).toHaveBeenCalledWith("/documents/nb1");
  });

  it("posts a project notebook with the project id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "nb2" }) });
    vi.stubGlobal("fetch", fetchMock);
    prompt.mockResolvedValue("Sprint log");
    await mountMenu(scope({ id: "p1" }));
    await choose("p1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      title: "Sprint log",
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: null,
    });
    expect(assign).toHaveBeenCalledWith("/documents/nb2");
  });

  it("posts nothing when the name prompt is cancelled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    prompt.mockResolvedValue(null);
    await mountMenu(scope({ id: "lab" }));
    await choose("lab");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows the server's message and stays put when the create fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Folder is too deeply nested" }) }),
    );
    prompt.mockResolvedValue("Deep");
    await mountMenu(scope({ id: "lab" }));
    await choose("lab");
    expect(toastError).toHaveBeenCalledWith("Folder is too deeply nested");
    expect(assign).not.toHaveBeenCalled();
  });
});
