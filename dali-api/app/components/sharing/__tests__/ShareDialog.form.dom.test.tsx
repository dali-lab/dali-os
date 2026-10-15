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
let posts: Record<string, string>[];
const writeText = vi.fn();

function stubFetch(kind: string, linkAccess = "LabMembers") {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = Object.fromEntries((init?.body as FormData).entries()) as Record<string, string>;
      posts.push(body);
      if (body.intent === "state") {
        return new Response(
          JSON.stringify({
            context: {
              linkAccess,
              linkPermission: "View",
              page: { workspaceType: "Lab", kind },
              owner: null,
            },
            shares: [{ id: "s1", principalType: "User", principalId: "u2", permission: "View", label: "Ada Lovelace" }],
            audience: null,
            inherited: null,
          }),
        );
      }
      return new Response(JSON.stringify({ groups: [], members: [] }));
    }),
  );
}

async function mount(props: { fillUrl?: string | null } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ShareDialog, {
        page: { id: "f1", title: "Intake", workspaceType: "Lab" },
        open: true,
        onClose: () => {},
        ...props,
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

describe("ShareDialog form variant", () => {
  it("names the per-person roles for filling and building, with no Comment", async () => {
    stubFetch("Form");
    await mount({ fillUrl: "/forms/fill/tok" });
    const trigger = byLabel("Access level for Ada Lovelace")!;
    expect(trigger.textContent).toBe("Can fill");
    await click(trigger);
    const listed = options();
    expect(listed).toHaveLength(3);
    expect(listed[0]).toContain("Can fill");
    expect(listed[0]).toContain("Fill out the form");
    expect(listed[1]).toContain("Can edit");
    expect(listed[1]).toContain("Edit questions and see responses");
    expect(listed[2]).toContain("Full access");
    expect(listed.join("|")).not.toContain("Comment");
  });

  it("offers the four fill audiences in lab wording", async () => {
    stubFetch("Form");
    await mount({ fillUrl: "/forms/fill/tok" });
    await click(byLabel("General access audience"));
    const listed = options();
    expect(listed).toHaveLength(4);
    expect(listed[0]).toContain("Only people you add");
    expect(listed[1]).toContain("Everyone in the lab");
    expect(listed[1]).toContain("Any lab member can fill it");
    expect(listed[2]).toContain("Anyone signed in");
    expect(listed[2]).toContain("Any account, including applicants and partners");
    expect(listed[3]).toContain("Anyone with the link");
    expect(listed[3]).toContain("No account needed");
  });

  it("hides the general access role dropdown", async () => {
    stubFetch("Form", "LabMembers");
    await mount({ fillUrl: "/forms/fill/tok" });
    expect(byLabel("General access role")).toBeNull();
  });

  it("keeps the role dropdown and the document wording on a document", async () => {
    stubFetch("FreeForm", "LabMembers");
    await mount();
    expect(byLabel("General access role")).not.toBeNull();
    expect(byLabel("Access level for Ada Lovelace")!.textContent).toBe("Can view");
  });

  it("sets Anyone signed in as fill (View) without a confirmation", async () => {
    stubFetch("Form", "Restricted");
    await mount({ fillUrl: "/forms/fill/tok" });
    await click(byLabel("General access audience"));
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Anyone signed in")));
    expect(confirm).not.toHaveBeenCalled();
    expect(posts.find((p) => p.intent === "general-access")).toMatchObject({
      linkAccess: "SignedIn",
      linkPermission: "View",
    });
  });

  it("asks before making a form public, in form wording, and stays View", async () => {
    stubFetch("Form", "Restricted");
    confirm.mockResolvedValue(true);
    await mount({ fillUrl: "/forms/fill/tok" });
    await click(byLabel("General access audience"));
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Anyone with the link")));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Make this form public?" }));
    expect(posts.find((p) => p.intent === "general-access")).toMatchObject({
      linkAccess: "Public",
      linkPermission: "View",
    });
  });

  it("sends Everyone in the lab as View on a form, not Edit", async () => {
    stubFetch("Form", "Restricted");
    await mount({ fillUrl: "/forms/fill/tok" });
    await click(byLabel("General access audience"));
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Everyone in the lab")));
    expect(posts.find((p) => p.intent === "general-access")).toMatchObject({
      linkAccess: "LabMembers",
      linkPermission: "View",
    });
  });
});

describe("ShareDialog form Copy link", () => {
  const copyButton = () => [...document.querySelectorAll("button")].find((b) => /Copy link|Copied/.test(b.textContent ?? ""))!;

  it("copies the fill url, not the document url", async () => {
    stubFetch("Form");
    await mount({ fillUrl: "/forms/fill/tok" });
    await click(copyButton());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/forms/fill/tok`);
  });

  it("is disabled with a hint while the form is unpublished", async () => {
    stubFetch("Form");
    await mount({ fillUrl: null });
    expect(copyButton().disabled).toBe(true);
    expect(text()).toContain("Publish to get a link");
    await click(copyButton());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("still copies the page url for a document, ignoring fillUrl", async () => {
    stubFetch("FreeForm");
    await mount({ fillUrl: null });
    expect(copyButton().disabled).toBe(false);
    expect(text()).not.toContain("Publish to get a link");
    await click(copyButton());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/documents/f1`);
  });
});

describe("ShareDialog meeting-granted rows", () => {
  function stubMeetingShares() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = Object.fromEntries((init?.body as FormData).entries()) as Record<string, string>;
        if (body.intent === "state") {
          return new Response(
            JSON.stringify({
              context: { linkAccess: "Restricted", linkPermission: "View", page: { workspaceType: "Lab", kind: "Notebook" }, owner: null },
              shares: [
                { id: "s1", principalType: "User", principalId: "u2", permission: "Edit", label: "Ada Lovelace", viaMeeting: { meetingTitle: "Weekly sync" } },
                { id: "s2", principalType: "User", principalId: "u3", permission: "View", label: "Grace Hopper", viaMeeting: null },
              ],
              audience: null,
              inherited: null,
            }),
          );
        }
        return new Response(JSON.stringify({ groups: [], members: [] }));
      }),
    );
  }

  it("names the meeting, locks the role and hides remove", async () => {
    stubMeetingShares();
    await mount();

    const via = document.querySelector('[data-testid="share-via-meeting"]') as HTMLElement;
    expect(via.textContent).toBe("via meeting Weekly sync");
    expect(via.getAttribute("title")).toBe("Added because they're on the meeting. Uninviting removes it.");
    expect(byLabel("Access level for Ada Lovelace")!.disabled).toBe(true);
    expect(byLabel("Remove Ada Lovelace")).toBeNull();
  });

  it("leaves an ordinary row editable and removable", async () => {
    stubMeetingShares();
    await mount();

    expect(document.querySelectorAll('[data-testid="share-via-meeting"]')).toHaveLength(1);
    expect(byLabel("Access level for Grace Hopper")!.disabled).toBe(false);
    expect(byLabel("Remove Grace Hopper")).toBeTruthy();
  });
});
