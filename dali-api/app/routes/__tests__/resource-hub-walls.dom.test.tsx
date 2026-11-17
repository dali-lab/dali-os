// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { renderDom, click } from "~/test-utils/render";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const confirm = vi.hoisted(() => vi.fn(async () => true));

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/resource-hub.server", () => ({ loadHubShell: vi.fn() }));
vi.mock("~/lib/crit.server", () => ({}));
vi.mock("~/lib/references.server", () => ({}));
vi.mock("~/lib/collabAuth.server", () => ({}));
vi.mock("~/lib/link-preview-limit.server", () => ({}));
vi.mock("~/lib/collab-token.server", () => ({}));
vi.mock("~/lib/ai.server", () => ({ isAiEnabled: () => false }));
vi.mock("~/components/doc", () => ({ DocEditor: () => null, uploadEditorImage: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm, alert: vi.fn(), prompt: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("~/components/resource-hub/crit/ShareWorkModal", () => ({
  ShareWorkModal: (p: { serverError: string | null }) => <div data-testid="share-modal">{p.serverError}</div>,
}));
vi.mock("~/components/resource-hub/crit/SubmissionOverlay", () => ({
  SubmissionOverlay: (p: { submission: { id: string }; edit?: { busy: boolean; result?: { error?: string } }; onChanged: () => void; onEdit: (t: string, q: string) => void; onDelete: () => void }) => (
    <div data-testid="overlay" data-id={p.submission.id}>
      <span data-testid="edit-error">{p.edit?.result?.error}</span>
      <button onClick={p.onChanged}>comment</button>
      <button onClick={() => p.onEdit("", "")}>edit</button>
      <button onClick={p.onDelete}>delete</button>
    </div>
  ),
}));
vi.mock("~/components/resource-hub/references/ReferenceModal", () => ({ ReferenceModal: () => null }));
vi.mock("~/components/resource-hub/references/ReferenceOverlay", () => ({ ReferenceOverlay: () => null }));
vi.mock("~/components/resource-hub/references/ReferenceCard", () => ({
  ReferenceCard: (p: { item: { id: string }; onDelete: () => void }) => <li><button onClick={p.onDelete}>delete {p.item.id}</button></li>,
}));

import Layout from "../resource-hub-layout";
import Crit from "../resource-hub.$pageId.crit";
import References from "../resource-hub.$pageId.references";

const hub = { id: "p1", title: "Design", coverUrl: "pattern:grid", published: true, hasDomain: true, domainName: "Design" };
const view = (id: string, commentCount: number) => ({
  id, title: id, question: null, kind: "image", url: "/a.png", previewUrl: null, fileName: null, anonymous: false, authorName: "Grace",
  mine: true, canDelete: true, canModerate: false, commentCount, createdAt: new Date(0).toISOString(),
});

let commentCounts: Record<string, number>;
let actionResult: { ok?: boolean; error?: string };
const actions: FormData[] = [];

function mount(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/resource-hub/:pageId",
        Component: Layout,
        loader: () => ({ hub, canEdit: true }),
        children: [
          {
            path: "crit",
            Component: Crit,
            loader: () => ({
              viewer: { id: "u1", name: "Ada", photoUrl: null }, userName: "Ada", domainName: "Design", pageId: "p1",
              items: [view("a", commentCounts.a), view("b", commentCounts.b)], nextCursor: null, linked: null,
            }),
            action: async ({ request }) => {
              actions.push(await request.formData());
              return actionResult;
            },
          },
          {
            path: "references",
            Component: References,
            loader: () => ({ pageId: "p1", items: [{ id: "r1", createdAt: new Date(0).toISOString() }], nextCursor: null, linked: null }),
            action: async ({ request }) => {
              actions.push(await request.formData());
              return actionResult;
            },
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return { router, ...renderDom(<RouterProvider router={router} />) };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const byText = (c: ParentNode, text: string) => [...c.querySelectorAll<HTMLElement>("button,[role='menuitem']")].find((b) => b.textContent?.trim() === text)!;
const overlay = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-testid='overlay']");

beforeEach(() => {
  commentCounts = { a: 0, b: 0 };
  actionResult = { ok: true };
  actions.length = 0;
  toast.error.mockClear();
});

describe("Crit Wall", () => {
  it("keeps the open post when a comment moves it out of the Needs feedback filter", async () => {
    const { container } = mount("/resource-hub/p1/crit?post=a");
    await settle();
    click(byText(container, "All work"));
    await settle();
    click(byText(document, "Needs feedback"));
    await settle();
    expect(overlay(container)?.dataset.id).toBe("a");

    commentCounts = { a: 1, b: 0 };
    click(byText(container, "comment"));
    await settle();
    expect(container.querySelectorAll("ul > li")).toHaveLength(1);
    expect(overlay(container)?.dataset.id).toBe("a");
  });

  it("shows a failed delete as a toast, keeps the post open and does not leak into Share work", async () => {
    actionResult = { error: "Forbidden" };
    const { container } = mount("/resource-hub/p1/crit?post=a");
    await settle();
    click(byText(container, "delete"));
    await settle();
    expect(actions.at(-1)!.get("intent")).toBe("delete");
    expect(toast.error).toHaveBeenCalledWith("Forbidden");
    expect(overlay(container)).not.toBeNull();
    click(byText(container, "Share work"));
    expect(container.querySelector("[data-testid='share-modal']")!.textContent).toBe("");
  });

  it("closes the post once a delete succeeds", async () => {
    const { container, router } = mount("/resource-hub/p1/crit?post=a");
    await settle();
    click(byText(container, "delete"));
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
    expect(router.state.location.search).toBe("");
    expect(overlay(container)).toBeNull();
  });

  it("gives a failed edit to the overlay, not to Share work", async () => {
    actionResult = { error: "Add a title." };
    const { container } = mount("/resource-hub/p1/crit?post=a");
    await settle();
    click(byText(container, "edit"));
    await settle();
    expect(container.querySelector("[data-testid='edit-error']")!.textContent).toBe("Add a title.");
    click(byText(container, "Share work"));
    expect(container.querySelector("[data-testid='share-modal']")!.textContent).toBe("");
  });
});

describe("References", () => {
  it("shows a failed delete as a toast", async () => {
    actionResult = { error: "Forbidden" };
    const { container } = mount("/resource-hub/p1/references");
    await settle();
    click(byText(container, "delete r1"));
    await settle();
    expect(actions.at(-1)!.get("intent")).toBe("delete");
    expect(toast.error).toHaveBeenCalledWith("Forbidden");
  });

  it("stays quiet when the delete works", async () => {
    const { container } = mount("/resource-hub/p1/references");
    await settle();
    click(byText(container, "delete r1"));
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
