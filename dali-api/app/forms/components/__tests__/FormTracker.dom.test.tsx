// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() });
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("~/components/os-chrome", () => ({ useOsChrome: () => ({ fieldLabel: "" }), modalCardClass: () => "" }));
vi.mock("~/components/Modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? children : null),
  ModalHeader: ({ title, subtitle }: { title: string; subtitle?: string }) =>
    createElement("div", null, createElement("h2", null, title), subtitle && createElement("p", null, subtitle)),
}));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: ({ name }: { name: string }) => createElement("i", null, name[0]) }));

import { FormTracker } from "~/forms/components/FormTracker";

let root: Root;
let container: HTMLDivElement;

const list = (over: Record<string, unknown> = {}) => ({
  formName: "Intake",
  published: true,
  closesAt: "2026-11-08T17:00:00.000Z",
  lastRemindedAt: null,
  expected: 4,
  notResponded: [
    { userId: "a", name: "Ada", photoUrl: null, sources: ["Core"], dismissed: false },
    { userId: "b", name: "Bo", photoUrl: null, sources: ["Core", "Announcement"], dismissed: false },
    { userId: "c", name: "Cy", photoUrl: null, sources: ["Announcement"], dismissed: true },
  ],
  ...over,
});

async function mount(counts: { expected: number; responded: number }, data: unknown = { list: list() }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const router = createMemoryRouter(
    [
      {
        path: "/forms/edit/f1",
        loader: () => data,
        action: () => ({ ok: true, sent: 2 }),
        element: createElement(FormTracker, { formId: "f1", counts }),
      },
    ],
    { initialEntries: ["/forms/edit/f1"] },
  );
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  return container;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (label: string | RegExp) =>
  [...document.querySelectorAll("button")].find((b) => (typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("FormTracker line", () => {
  it("shows the progress and a link to the people who have not responded", async () => {
    const el = await mount({ expected: 71, responded: 58 });
    expect(el.textContent).toContain("58 of 71 expected people responded");
    expect(el.textContent).toContain("13 not responded");
    expect(el.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("58");
  });

  it("shows a full bar and no link once everyone has responded", async () => {
    const el = await mount({ expected: 3, responded: 3 });
    expect(el.textContent).toContain("3 of 3 expected people responded");
    expect(el.textContent).not.toContain("not responded");
    expect((el.querySelector('[role="progressbar"] > div') as HTMLElement).style.width).toBe("100%");
  });

  it("says person for one", async () => {
    const el = await mount({ expected: 1, responded: 0 });
    expect(el.textContent).toContain("0 of 1 expected person responded");
  });
});

describe("FormTracker modal", () => {
  async function open() {
    await mount({ expected: 4, responded: 1 });
    await act(async () => button(/not responded/)!.click());
    await flush();
  }

  it("lists people with dismissed last and says who won't be reminded", async () => {
    await open();
    const text = document.body.textContent ?? "";
    expect(text).toContain("3 of 4 people. Closes Nov 8.");
    expect(text.indexOf("Ada")).toBeLessThan(text.indexOf("Cy"));
    expect(text).toContain("Dismissed");
    expect(text).toContain("1 dismissed the to-do and won't be reminded.");
    expect(button("Remind 2 people")?.disabled).toBe(false);
  });

  it("opens the composer prefilled and goes back", async () => {
    await open();
    await act(async () => button("Remind 2 people")!.click());
    expect(document.body.textContent).toContain("Sent as a notification with a link to the form.");
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "You haven't filled out Intake yet. It closes Nov 8.",
    );
    await act(async () => button("Back")!.click());
    expect(button("Remind 2 people")).toBeDefined();
  });

  it("sends, toasts and returns to the list", async () => {
    await open();
    await act(async () => button("Remind 2 people")!.click());
    await act(async () => button("Send reminder")!.click());
    await flush();
    expect(toast.success).toHaveBeenCalledWith("Reminder sent to 2 people.");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("disables the button and explains an unpublished form", async () => {
    await mount({ expected: 4, responded: 1 }, { list: list({ published: false }) });
    await act(async () => button(/not responded/)!.click());
    await flush();
    expect(button("Remind 2 people")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("This form isn't published, so a reminder would link to nothing.");
  });

  it("disables the button when only dismissed people are left", async () => {
    await mount({ expected: 4, responded: 1 }, { list: list({ notResponded: [list().notResponded[2]] }) });
    await act(async () => button(/not responded/)!.click());
    await flush();
    expect(button("Remind 0 people")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Everyone left dismissed the to-do, so there's nobody to remind.");
  });

  it("disables the button inside 24 hours of the last reminder", async () => {
    const recent = new Date(Date.now() - 3600_000).toISOString();
    await mount({ expected: 4, responded: 1 }, { list: list({ lastRemindedAt: recent }) });
    await act(async () => button(/not responded/)!.click());
    await flush();
    expect(button("Remind 2 people")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Last reminder");
  });
});
