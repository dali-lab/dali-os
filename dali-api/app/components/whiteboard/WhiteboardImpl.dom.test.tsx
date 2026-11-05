// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("./whiteboard.css", () => ({}));
vi.mock("@excalidraw/excalidraw", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  const MainMenu = Object.assign(Passthrough, {
    Item: Passthrough,
    Separator: () => null,
    DefaultItems: { SaveAsImage: () => null, ChangeCanvasBackground: () => null, Help: () => null },
  });
  const WelcomeScreen = Object.assign(Passthrough, {
    Center: Object.assign(Passthrough, { Heading: Passthrough }),
  });
  return {
    Excalidraw: ({ children, renderTopRightUI }: { children?: ReactNode; renderTopRightUI?: () => ReactNode }) =>
      createElement("div", { "data-testid": "canvas" }, renderTopRightUI?.(), children),
    MainMenu,
    WelcomeScreen,
    Footer: Passthrough,
    FONT_FAMILY: { Nunito: 1 },
    CaptureUpdateAction: { IMMEDIATELY: "i" },
  };
});
vi.mock("~/components/doc/collab-doc", () => ({ acquireCollabDoc: vi.fn(), releaseCollabDoc: vi.fn(), nameToHexColor: () => "#000" }));
vi.mock("./whiteboard-yjs", () => ({ bindExcalidrawToYjs: vi.fn() }));
vi.mock("./upload", () => ({ uploadWhiteboardImage: vi.fn() }));
vi.mock("./MermaidDialog", () => ({ MermaidDialog: () => null }));
vi.mock("~/components/sharing/ShareDialog", () => ({
  ShareDialog: ({ open }: { open: boolean }) => (open ? createElement("div", { "data-testid": "share-dialog" }) : null),
}));

const { default: WhiteboardImpl } = await import("./WhiteboardImpl");
const { PageBarSlotProvider, usePageBarTargetSetters } = await import("~/components/shell/page-bar-slot");
const { DialogProvider } = await import("~/components/ui/dialog");
const { PageBarTrail } = await import("~/components/Breadcrumbs");
const { ToastProvider } = await import("~/components/ui/toast");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

let container: HTMLDivElement;
let root: Root;

function Bar() {
  const { actionsRef } = usePageBarTargetSetters();
  return createElement("div", null, createElement(PageBarTrail, { crumbs }), createElement("div", { "data-testid": "actions", ref: actionsRef }));
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

const meeting = {
  id: "m1",
  title: "Fall kickoff",
  notePageId: "n1",
  startIso: "2026-11-05T15:00:00.000Z",
  location: null,
  roomNames: ["Studio A"],
  attendance: { attended: 3, expected: 4 },
};

async function mount(over: Record<string, unknown> = {}) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(
            DialogProvider,
            null,
            createElement(PageBarSlotProvider, {
              children: createElement(
                "div",
                null,
                createElement(Bar),
                createElement(WhiteboardImpl, {
                  pageId: "w1",
                  title: "Board",
                  iconEmoji: null,
                  canEdit: true,
                  collabToken: null,
                  userName: "Ada",
                  currentUserId: "u1",
                  photoUrl: null,
                  canManageAccess: true,
                  workspaceType: "Lab",
                  meeting: null,
                  ...over,
                } as never),
              ),
            }),
          ),
        ),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/whiteboard/w1"] }));
  });
}

const actions = () => container.querySelector("[data-testid=actions]")!;

afterEach(() => {
  globalThis.fetch = originalFetch;
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("WhiteboardImpl page bar", () => {
  it("puts Full screen and Share in the actions slot, not on the canvas", async () => {
    await mount();
    expect([...actions().querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Full screen", "Share"]);
    expect(container.querySelector("[data-testid=canvas] [aria-label='Full screen']")).toBeNull();
  });

  it("leaves Share out without manage access", async () => {
    await mount({ canManageAccess: false });
    expect([...actions().querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Full screen"]);
  });

  it("opens the share dialog", async () => {
    await mount();
    await act(async () => actions().querySelector<HTMLElement>("[aria-label='Share']")!.click());
    expect(document.body.querySelector("[data-testid=share-dialog]")).not.toBeNull();
  });

  it("toggles full screen from the bar and keeps an exit control on the canvas", async () => {
    await mount();
    await act(async () => actions().querySelector<HTMLElement>("[aria-label='Full screen']")!.click());
    expect(actions().querySelector("[aria-label='Exit full screen']")).not.toBeNull();
    expect(container.querySelector("[data-testid=canvas] [aria-label='Exit full screen']")).not.toBeNull();
    expect(container.querySelector(".dali-whiteboard")!.className).toContain("fixed");
  });
});

describe("WhiteboardImpl meeting strip", () => {
  it("shows no strip, and no old context bar, on a plain board", async () => {
    await mount();
    expect(container.querySelector("[data-testid=meeting-strip]")).toBeNull();
  });

  it("shows the strip with Meeting note, Attendance N of M and Record on a meeting board", async () => {
    await mount({ meeting });
    const strip = container.querySelector("[data-testid=meeting-strip]")!;
    expect(strip.textContent).toContain("Fall kickoff");
    const links = [...strip.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Meeting note", "/documents/n1"],
      ["Attendance3 of 4", "/calendar/meeting/m1"],
    ]);
    expect(strip.textContent).toContain("Record");
    expect(container.querySelector(".border-b.border-border.bg-card")).toBeNull();
  });

  it("omits Record when the board has no note or the viewer cannot edit", async () => {
    await mount({ meeting: { ...meeting, notePageId: null } });
    expect(container.querySelector("[data-testid=meeting-strip]")!.textContent).not.toContain("Record");
  });
});

describe("WhiteboardImpl title crumb", () => {
  it("renames through /api/documents/:id on Enter", async () => {
    const fetchMock = mockFetch();
    await mount();
    await act(async () => container.querySelector<HTMLElement>("button[aria-label='Rename']")!.click());
    await typeName("Renamed board");
    expect(bodies(fetchMock, "/api/documents/w1")).toEqual([{ title: "Renamed board" }]);
  });

  it("keeps the crumb glyph static for an editor", async () => {
    await mount();
    expect(container.querySelector("[data-testid=glyph]")!.closest("button")).toBeNull();
  });
});

describe("WhiteboardImpl page title", () => {
  it("renames from the page title through /api/documents/:id", async () => {
    const fetchMock = mockFetch();
    await mount();
    const input = container.querySelector<HTMLInputElement>("input[aria-label='Title']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed board");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(bodies(fetchMock, "/api/documents/w1")).toEqual([{ title: "Renamed board" }]);
  });

  it("saves the icon from the page title through /api/documents/:id", async () => {
    const fetchMock = mockFetch();
    await mount();
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Add icon")!.click());
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "🚀")!.click());
    expect(bodies(fetchMock, "/api/documents/w1")).toEqual([{ iconEmoji: "🚀" }]);
  });

  it("shows a plain title for a viewer", async () => {
    await mount({ canEdit: false });
    expect(container.querySelector("button[aria-label='Rename']")).toBeNull();
    expect(container.querySelector("input[aria-label='Title']")).toBeNull();
    expect(container.querySelector("h1")).not.toBeNull();
  });

  it("hides the page title in full screen", async () => {
    await mount();
    await act(async () => container.querySelector<HTMLElement>("button[aria-label='Full screen']")!.click());
    expect(container.querySelector("input[aria-label='Title']")).toBeNull();
  });
});
