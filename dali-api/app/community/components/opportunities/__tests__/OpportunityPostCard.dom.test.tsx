// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const submit = vi.fn();
vi.mock("react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useFetcher: () => ({ submit, state: "idle", data: undefined, formData: undefined }),
}));
vi.mock("~/components/ReactionBar", () => ({ ReactionBar: () => null, useReactionToggle: () => ({ reactions: [], react: vi.fn() }) }));
vi.mock("~/components/PostComments", () => ({ PostComments: () => null }));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: () => null }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn(async () => true) }) }));
vi.mock("~/components/ui/floating", () => ({
  Menu: ({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {trigger}
      <div data-testid="menu">{children}</div>
    </div>
  ),
  MenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
}));
vi.mock("~/components/ui/IconButton", () => ({ IconButton: ({ label }: { label: string }) => <button aria-label={label} /> }));
vi.mock("~/components/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
}));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ card: "", panelPad: "", formClass: "", fieldLabel: "" }),
  modalCardClass: () => "",
}));
vi.mock("~/community/components/opportunities/LogoBlock", () => ({
  LogoBlock: ({ name }: { name: string }) => <span data-testid="logo">{name}</span>,
}));
vi.mock("~/community/components/opportunities/OpportunityComposer", () => ({ OpportunityComposer: () => null }));

import { OpportunityPostCard } from "../OpportunityPostCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  id: "p1",
  kind: "Job",
  body: "We are hiring",
  topic: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  author: { id: "ada", name: "Ada Lovelace", photoUrl: null, classYear: 2019 },
  job: {
    url: "https://jobs.example.com/1",
    companyName: "Acme",
    companyDomain: null,
    logoUrl: null,
    blockColor: null,
    role: "Designer",
    location: "Remote",
    jobType: "Full-time",
    willRefer: true,
  },
  imageUrl: null,
  matchReason: null,
  responseCount: 0,
  viewerResponded: false,
  isOwn: false,
  askStillOpen: false,
  canDelete: false,
  canClose: false,
  reactions: [],
  comments: [],
};

let root: Root;
let host: HTMLDivElement;

function render(over: Record<string, unknown> = {}) {
  act(() => {
    root.render(<OpportunityPostCard post={{ ...base, ...over } as never} />);
  });
}
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
const click = (label: string) =>
  act(() => {
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeEach(() => {
  submit.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("job post", () => {
  it("shows the logo, role, meta line and I'm interested", () => {
    render();
    expect(host.querySelector("[data-testid=logo]")?.textContent).toBe("Acme");
    expect(host.textContent).toContain("Designer");
    expect(host.textContent).toContain("Acme · Remote · Full-time · Will refer");
    expect(host.textContent).toContain("Class of 2019");
    expect(buttons()).toContain("I'm interested");
  });

  it("opens a note dialog and submits the interest", () => {
    render();
    click("I'm interested");
    const note = host.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(note, "Hello");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submit).toHaveBeenCalledWith({ intent: "interested", postId: "p1", note: "Hello" }, { method: "post" });
  });

  it("shows a done state once the viewer responded", () => {
    render({ viewerResponded: true });
    const done = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Interested")!;
    expect(done.disabled).toBe(true);
    expect(buttons()).not.toContain("I'm interested");
  });

  it("hides the button on your own post and shows author controls", () => {
    render({ isOwn: true, canDelete: true, canClose: true });
    expect(buttons()).not.toContain("I'm interested");
    expect(buttons()).toContain("Mark as filled");
    expect(buttons()).toContain("Delete");
  });

  it("shows no controls to a non-author, and only Delete to Core", () => {
    render();
    expect(host.querySelector("[aria-label=More]")).toBeNull();
    render({ canDelete: true });
    expect(buttons()).toContain("Delete");
    expect(buttons()).not.toContain("Mark as filled");
  });

  it("asks the author whether it is still open", () => {
    render({ isOwn: true, askStillOpen: true });
    expect(host.textContent).toContain("Is this still open?");
    click("Still open");
    expect(submit).toHaveBeenCalledWith({ intent: "keep-open", postId: "p1" }, { method: "post" });
    click("Filled");
    expect(submit).toHaveBeenCalledWith({ intent: "close", postId: "p1" }, { method: "post" });
  });

  it("doesn't show the prompt to anyone but the author", () => {
    render();
    expect(host.textContent).not.toContain("Is this still open?");
  });
});

describe("chat ask post", () => {
  const ask = { kind: "ChatAsk", job: null, topic: "Product design", matchReason: "askMeAbout", responseCount: 2 };

  it("shows the topic, the match reason and the offer count", () => {
    render(ask);
    expect(host.textContent).toContain("Coffee chat · Product design");
    expect(host.textContent).toContain("It's on your Ask me about list · 2 offered");
    expect(buttons()).toContain("Offer a chat");
  });

  it("offers a chat", () => {
    render(ask);
    click("Offer a chat");
    expect(submit).toHaveBeenCalledWith({ intent: "offer-chat", postId: "p1" }, { method: "post" });
  });

  it("shows the done state and hides the button on your own ask", () => {
    render({ ...ask, viewerResponded: true });
    expect(buttons()).toContain("Offered");
    render({ ...ask, isOwn: true, canClose: true, canDelete: true });
    expect(buttons()).not.toContain("Offer a chat");
    expect(buttons()).toContain("Mark as done");
  });
});

describe("DALI update", () => {
  it("has no attachment card, only an image when it has one", () => {
    render({ kind: "DaliUpdate", job: null, author: { id: null, name: "DALI Lab", photoUrl: null, classYear: null } });
    expect(host.textContent).toContain("DALI Lab");
    expect(buttons()).toEqual([]);
    expect(host.querySelector("img")).toBeNull();
    render({ kind: "DaliUpdate", job: null, imageUrl: "/api/upload/raw?key=x" });
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/upload/raw?key=x");
  });
});
