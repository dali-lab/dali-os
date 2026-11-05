// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const confirm = vi.fn();
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));

import { ShareDialog } from "~/components/sharing/ShareDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let requests: { url: string; body: Record<string, string> }[];
const writeText = vi.fn();

function stubFetch(opts: { inherited?: unknown; linkAccess?: string; linkPermission?: string } = {}) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = Object.fromEntries((init?.body as FormData).entries()) as Record<string, string>;
      requests.push({ url, body });
      if (body.intent === "state") {
        return new Response(
          JSON.stringify({
            context: {
              file: { id: "file-1", title: "Budget.xlsx", workspaceType: "Lab" },
              linkAccess: opts.linkAccess ?? "Restricted",
              linkPermission: opts.linkPermission ?? "View",
              owner: { id: "o1", name: "Grace Hopper", isYou: false },
              inheritedAccess: "inherited" in opts ? opts.inherited : { kind: "folder", name: "Finance" },
            },
            shares: [{ id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Ada Lovelace" }],
          }),
        );
      }
      return new Response(JSON.stringify({ groups: [], members: [] }));
    }),
  );
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ShareDialog, {
        target: { kind: "file", id: "file-1", title: "Budget.xlsx" },
        open: true,
        onClose: () => {},
      }),
    );
  });
  await act(async () => {});
}

const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
const text = () => document.body.textContent ?? "";
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");

beforeEach(() => {
  confirm.mockReset();
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe("ShareDialog file mode", () => {
  it("talks to the file share endpoint, not the page one", async () => {
    stubFetch();
    await mount();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.url === "/api/files/file-1/share")).toBe(true);
  });

  it("shows inherited access as a read-only row above the named shares", async () => {
    stubFetch();
    await mount();
    const row = document.querySelector('[data-testid="share-file-inherited"]')!;
    expect(row.textContent).toContain("People with access to folder Finance");
    expect(row.querySelector("button, select, input")).toBeNull();
    const list = document.querySelector("ul")!;
    expect(row.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the project or the Lab when the file has no folder", async () => {
    stubFetch({ inherited: { kind: "lab", name: "the Lab" } });
    await mount();
    expect(document.querySelector('[data-testid="share-file-inherited"]')!.textContent).toContain(
      "People with access to the Lab",
    );
  });

  it("shows no inherited row for a My Drive file", async () => {
    stubFetch({ inherited: null });
    await mount();
    expect(document.querySelector('[data-testid="share-file-inherited"]')).toBeNull();
  });

  it("lists the owner and the named shares with file role wording", async () => {
    stubFetch();
    await mount();
    expect(text()).toContain("Grace Hopper");
    expect(text()).toContain("Ada Lovelace");
    await click(byLabel("Access level for Ada Lovelace"));
    expect(options().join("|")).toContain("Upload new versions, rename and delete");
  });

  it("changes a person's level through the file endpoint", async () => {
    stubFetch();
    await mount();
    await click(byLabel("Access level for Ada Lovelace"));
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Can edit")));
    expect(requests.find((r) => r.body.intent === "share-change")).toMatchObject({
      url: "/api/files/file-1/share",
      body: { principalType: "User", principalId: "u2", permission: "Edit" },
    });
  });

  it("offers only people-you-add and the lab as general access, never public", async () => {
    stubFetch();
    await mount();
    await click(byLabel("General access audience"));
    const listed = options();
    expect(listed).toHaveLength(2);
    expect(listed[0]).toContain("Only people you add");
    expect(listed[1]).toContain("Everyone in the lab");
    expect(listed.join("|")).not.toContain("Anyone with the link");
  });

  it("opens the file to the lab as View with no confirmation", async () => {
    stubFetch();
    await mount();
    await click(byLabel("General access audience"));
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Everyone in the lab")));
    expect(confirm).not.toHaveBeenCalled();
    expect(requests.find((r) => r.body.intent === "general-access")!.body).toMatchObject({
      linkAccess: "LabMembers",
      linkPermission: "View",
    });
  });

  it("shows no folder access or partner sections", async () => {
    stubFetch({ linkAccess: "LabMembers" });
    await mount();
    expect(byLabel("Folder access")).toBeNull();
    expect(text()).not.toContain("Visible to partners");
    expect(byLabel("General access role")).not.toBeNull();
  });

  it("copies the file page link", async () => {
    stubFetch();
    await mount();
    await click([...document.querySelectorAll("button")].find((b) => /Copy link/.test(b.textContent ?? "")));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/documents/file/file-1`);
  });
});
