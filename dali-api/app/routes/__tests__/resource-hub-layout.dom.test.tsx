// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { renderDom, click } from "~/test-utils/render";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/resource-hub.server", () => ({ loadHubShell: vi.fn() }));
vi.mock("~/lib/crit.server", () => ({}));
vi.mock("~/lib/references.server", () => ({}));
vi.mock("~/lib/crit-comments", () => ({ parseCritLink: () => ({ submissionId: null, threadId: null }) }));
vi.mock("~/lib/collabAuth.server", () => ({}));
vi.mock("~/lib/link-preview-limit.server", () => ({}));
vi.mock("~/lib/collab-token.server", () => ({}));
vi.mock("~/lib/ai.server", () => ({ isAiEnabled: () => false }));
vi.mock("~/components/doc", () => ({ DocEditor: () => <div data-testid="editor" />, uploadEditorImage: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn(), alert: vi.fn(), prompt: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("~/components/resource-hub/crit/ShareWorkModal", () => ({ ShareWorkModal: () => <div data-testid="share-modal" /> }));
vi.mock("~/components/resource-hub/crit/SubmissionOverlay", () => ({ SubmissionOverlay: () => null }));
vi.mock("~/components/resource-hub/references/ReferenceModal", () => ({ ReferenceModal: () => <div data-testid="reference-modal" /> }));
vi.mock("~/components/resource-hub/references/ReferenceOverlay", () => ({ ReferenceOverlay: () => null }));

import Layout from "../resource-hub-layout";
import Resources from "../resource-hub.$pageId";
import Crit from "../resource-hub.$pageId.crit";
import References from "../resource-hub.$pageId.references";

const hub = { id: "p1", title: "Design", coverUrl: "pattern:petal-ledger?d=frame,seal&c=plum", published: true, hasDomain: true, domainName: "Design" };
const crit = { viewer: { id: "u1", name: "Ada", photoUrl: null }, userName: "Ada", domainName: "Design", items: [] };
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
          { path: "crit", Component: Crit, loader: () => crit },
          { path: "references", Component: References, loader: () => ({ items: [] }) },
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
  it("links the three tabs and marks the open one", async () => {
    const { container } = mount("/resource-hub/p1/crit");
    await settle();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Hub sections"] a')];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Resources", "/resource-hub/p1"],
      ["Crit Wall", "/resource-hub/p1/crit"],
      ["References", "/resource-hub/p1/references"],
    ]);
    expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["Crit Wall"]);
  });

  it("shows only Resources for a hub with no domain", async () => {
    const { container } = mount("/resource-hub/p1", { hub: { hasDomain: false, domainName: undefined } });
    await settle();
    expect([...container.querySelectorAll('nav[aria-label="Hub sections"] a')].map((a) => a.textContent)).toEqual(["Resources"]);
  });

  it("puts the title, domain and cover in the band", async () => {
    const { container } = mount("/resource-hub/p1/crit");
    await settle();
    const band = container.querySelector('[data-testid="hub-band"]')!;
    expect(band.querySelector("h1")?.textContent).toBe("Design");
    expect(band.textContent).toContain("Design");
    expect(band.querySelector("svg")).not.toBeNull();
    expect((band as HTMLElement).style.backgroundColor).toBe("var(--art-plum)");
  });

  it("keeps the same header node across every tab switch", async () => {
    const { container, router } = mount("/resource-hub/p1");
    await settle();
    const band = container.querySelector('[data-testid="hub-band"]');
    const title = container.querySelector("h1");
    for (const to of ["/resource-hub/p1/crit", "/resource-hub/p1/references", "/resource-hub/p1"]) {
      await act(async () => { await router.navigate(to); });
      await settle();
      expect(container.querySelector('[data-testid="hub-band"]')).toBe(band);
      expect(container.querySelector("h1")).toBe(title);
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    }
  });

  it("renders Crit Wall's filter and primary Share work in the row", async () => {
    const { container } = mount("/resource-hub/p1/crit");
    await settle();
    expect(rowButtons(container)).toEqual(expect.arrayContaining(["All work", "Share work"]));
    expect(rowButtons(container).at(-2)).toBe("Share work");
    expect(container.querySelector('[data-testid="share-modal"]')).toBeNull();
    click([...row(container).querySelectorAll("button")].find((b) => b.textContent?.trim() === "Share work")!);
    expect(container.querySelector('[data-testid="share-modal"]')).not.toBeNull();
  });

  it("renders References' add action in the row", async () => {
    const { container } = mount("/resource-hub/p1/references");
    await settle();
    expect(rowButtons(container)).toContain("Add reference");
    click([...row(container).querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add reference")!);
    expect(container.querySelector('[data-testid="reference-modal"]')).not.toBeNull();
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

  it("swaps the controls when the tab changes", async () => {
    const { container, router } = mount("/resource-hub/p1/crit");
    await settle();
    await act(async () => { await router.navigate("/resource-hub/p1/references"); });
    await settle();
    expect(rowButtons(container)).toContain("Add reference");
    expect(rowButtons(container)).not.toContain("Share work");
  });

  it("shows the gear for editors only", async () => {
    const editor = mount("/resource-hub/p1/crit");
    await settle();
    expect(editor.container.querySelector('[aria-label="Edit title and cover"]')).not.toBeNull();
    editor.unmount();
    const viewer = mount("/resource-hub/p1/crit", { canEdit: false });
    await settle();
    expect(viewer.container.querySelector('[aria-label="Edit title and cover"]')).toBeNull();
  });

  it("opens the title and cover editor from the gear", async () => {
    const { container } = mount("/resource-hub/p1/references");
    await settle();
    click(container.querySelector('[aria-label="Edit title and cover"]')!);
    expect((document.body.querySelector("input") as HTMLInputElement).value).toBe("Design");
    expect(document.body.textContent).toContain("Edit title and cover");
  });

  it("marks a draft hub in the band", async () => {
    const { container } = mount("/resource-hub/p1/crit", { hub: { published: false } });
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
