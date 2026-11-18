// @vitest-environment jsdom
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { renderDom } from "~/test-utils/render";
import type { Paperwork } from "../../lib/paperwork";
import { PaperworkPage } from "../PaperworkPage";

const EMPTY: Paperwork = { termLabel: "Fall 2026", waiting: [], term: [], anytime: [], setup: [] };

function mount(over: Partial<Paperwork> = {}) {
  const { container } = renderDom(
    <MemoryRouter>
      <PaperworkPage data={{ ...EMPTY, ...over }} />
    </MemoryRouter>,
  );
  return container;
}

const section = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`section[aria-label='${name}']`);
const link = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll("a")).find((a) => a.textContent === text);

describe("PaperworkPage", () => {
  it("says nothing is waiting and shows no waiting section when the member is caught up", () => {
    const c = mount();
    expect(c.textContent).toContain("Nothing is waiting on you.");
    expect(section(c, "Waiting on you")).toBeNull();
  });

  it("lists waiting items with their action links", () => {
    const c = mount({
      waiting: [
        { id: "expense-e1", kind: "expense", title: "Gnomon · $40.00", detail: "Sent back.", action: { label: "Open expense", href: "/expenses?expense=e1" } },
        { id: "sign-b1", kind: "signature", title: "Term agreement", detail: "Waiting on your signature.", action: { label: "Review and sign", href: "/sign/b1" } },
      ],
    });
    const waiting = section(c, "Waiting on you")!;
    expect(c.textContent).not.toContain("Nothing is waiting on you.");
    expect(link(waiting, "Open expense")?.getAttribute("href")).toBe("/expenses?expense=e1");
    expect(link(waiting, "Review and sign")?.getAttribute("href")).toBe("/sign/b1");
  });

  it("shows the term's rows with status and a done count", () => {
    const c = mount({
      term: [
        { id: "form-a", kind: "form", title: "Intent to work", detail: "Sent Nov 4", status: "done", action: { label: "View", href: "/forms/fill/a" } },
        { id: "classes", kind: "classes", title: "Classes", detail: "None added yet", status: "todo", action: { label: "Add classes", href: "/calendar?settings=classes" } },
      ],
    });
    const term = section(c, "This term")!;
    expect(term.textContent).toContain("Fall 2026 · 1 of 2 done");
    expect(term.textContent).toContain("Done");
    expect(term.textContent).toContain("To do");
    expect(link(term, "Add classes")?.getAttribute("href")).toBe("/calendar?settings=classes");
  });

  it("says nothing is open when the term has no rows", () => {
    const term = section(mount(), "This term")!;
    expect(term.textContent).toContain("Nothing open for this term yet");
    expect(term.textContent).toContain("Fall 2026");
    expect(term.textContent).not.toContain("done");
  });

  it("links each anytime tile to its page", () => {
    const c = mount({ anytime: [{ id: "refer", title: "Refer a partner", detail: "1 sent", href: "/refer" }] });
    const tile = section(c, "Anytime")!.querySelector("a")!;
    expect(tile.getAttribute("href")).toBe("/refer");
    expect(tile.textContent).toBe("Refer a partner1 sent");
  });

  it("hides the anytime and setup sections when they're empty", () => {
    const c = mount();
    expect(section(c, "Anytime")).toBeNull();
    expect(section(c, "Set up once")).toBeNull();
  });

  it("offers an action only on setup items that aren't done", () => {
    const c = mount({
      setup: [
        { id: "wallet", title: "Lab pass in your wallet", detail: "For checking in to meetings", done: false, action: { label: "Add", href: "/settings/general" } },
        { id: "desktop", title: "Desktop app", detail: "DALI OS for macOS, Windows and Linux", done: true, action: { label: "Download", href: "/download" } },
      ],
    });
    const setup = section(c, "Set up once")!;
    expect(setup.textContent).toContain("1 of 2 done");
    expect(link(setup, "Add")?.getAttribute("href")).toBe("/settings/general");
    expect(link(setup, "Download")).toBeUndefined();
    expect(setup.textContent).not.toContain("DALI OS for macOS");
  });
});
