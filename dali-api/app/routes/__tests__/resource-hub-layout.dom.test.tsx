// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { renderDom, click } from "~/test-utils/render";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/resource-hub.server", () => ({ loadHubShell: vi.fn() }));
vi.mock("~/lib/collabAuth.server", () => ({}));
vi.mock("~/lib/link-preview-limit.server", () => ({}));
vi.mock("~/lib/collab-token.server", () => ({}));
vi.mock("~/lib/ai.server", () => ({ isAiEnabled: () => false }));
vi.mock("~/components/doc", () => ({ DocEditor: () => <div data-testid="editor" />, uploadEditorImage: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn(), alert: vi.fn(), prompt: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));

import Layout from "../resource-hub-layout";
import Resources from "../resource-hub.$pageId";

const hub = { id: "p1", title: "Design", coverUrl: "pattern:petal-ledger?d=frame,seal&c=plum", published: true, domainName: "Design" };
const resources = { page: { id: "p1", title: "Design", published: true, contentJson: [] }, canEdit: true, aiEnabled: false, collabToken: "t", currentUserId: "u1", userName: "Ada" };

type Result = Record<string, unknown>;
function mount(
  path: string,
  over: { canEdit?: boolean; hub?: Partial<typeof hub>; collabToken?: string | null; layoutAction?: () => Result; pageAction?: () => Result } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: "/resource-hub/:pageId",
        Component: Layout,
        loader: () => ({ hub: { ...hub, ...over.hub }, canEdit: over.canEdit ?? true }),
        action: over.layoutAction,
        children: [
          { index: true, Component: Resources, action: over.pageAction, loader: () => ({ ...resources, canEdit: over.canEdit ?? true, collabToken: over.collabToken === undefined ? "t" : over.collabToken }) },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = renderDom(<RouterProvider router={router} />);
  return { router, ...view };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const row = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-density]")!;
const rowButtons = (c: HTMLElement) => [...row(c).querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("Resource Hub layout", () => {
  it("puts the title, domain and cover in the band", async () => {
    const { container } = mount("/resource-hub/p1");
    await settle();
    const band = container.querySelector('[data-testid="hub-band"]')!;
    expect(band.querySelector("h1")?.textContent).toBe("Design");
    expect(band.textContent).toContain("Design");
    expect(band.querySelector("svg")).not.toBeNull();
    expect((band as HTMLElement).style.backgroundColor).toBe("var(--art-plum)");
  });

  it("has no tab row, only the page controls and the gear", async () => {
    const { container } = mount("/resource-hub/p1");
    await settle();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[data-slot="island"]')).toBeNull();
    expect(rowButtons(container)).toEqual(["Preview", "Delete", "Update", "Edit title and cover"]);
  });

  it("renders Resources' preview, delete and publish actions in the row for an editor", async () => {
    const { container } = mount("/resource-hub/p1");
    await settle();
    expect(rowButtons(container)).toEqual(expect.arrayContaining(["Preview", "Delete", "Update"]));
  });

  it("gives a viewer who can't edit no Resources actions", async () => {
    const { container } = mount("/resource-hub/p1", { canEdit: false, collabToken: null });
    await settle();
    expect(rowButtons(container)).toEqual([]);
  });

  it("shows the gear for editors only", async () => {
    const editor = mount("/resource-hub/p1");
    await settle();
    expect(editor.container.querySelector('[aria-label="Edit title and cover"]')).not.toBeNull();
    editor.unmount();
    const viewer = mount("/resource-hub/p1", { canEdit: false });
    await settle();
    expect(viewer.container.querySelector('[aria-label="Edit title and cover"]')).toBeNull();
  });

  it("opens the title and cover editor from the gear", async () => {
    const { container } = mount("/resource-hub/p1");
    await settle();
    click(container.querySelector('[aria-label="Edit title and cover"]')!);
    expect((document.body.querySelector("input") as HTMLInputElement).value).toBe("Design");
    expect(document.body.textContent).toContain("Edit title and cover");
  });

  it("marks a draft hub in the band", async () => {
    const { container } = mount("/resource-hub/p1", { hub: { published: false } });
    await settle();
    expect(container.querySelector('[data-testid="hub-band"]')?.textContent).toContain("Draft");
  });

  it("does not show an old save error when the editor is opened again", async () => {
    const { container } = mount("/resource-hub/p1", { layoutAction: () => ({ error: "Title is taken." }) });
    await settle();
    const gear = () => container.querySelector<HTMLElement>('[aria-label="Edit title and cover"]')!;
    click(gear());
    click([...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save")!);
    await settle();
    expect(document.body.textContent).toContain("Title is taken.");
    click([...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel")!);
    await settle();
    click(gear());
    expect(document.body.textContent).not.toContain("Title is taken.");
  });

  it("says the hub was updated only after the update succeeds", async () => {
    const { container } = mount("/resource-hub/p1", { pageAction: () => ({ ok: true }) });
    await settle();
    click(container.querySelector('[aria-label="Update"]') ?? [...row(container).querySelectorAll("button")].find((b) => b.textContent?.trim() === "Update")!);
    expect(toast.success).not.toHaveBeenCalled();
    await settle();
    expect(toast.success).toHaveBeenCalledWith("Hub updated.");
  });

  it("shows an error when the update fails", async () => {
    const { container } = mount("/resource-hub/p1", { pageAction: () => ({ error: "x" }) });
    await settle();
    click([...row(container).querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Update" || b.textContent?.trim() === "Update")!);
    await settle();
    expect(toast.error).toHaveBeenCalledWith("Couldn't publish. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
