// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const submit = vi.fn();
vi.mock("react-router", () => ({
  useFetcher: () => ({ submit, state: "idle", data: undefined }),
}));
vi.mock("~/components/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
}));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ formClass: "", fieldLabel: "" }),
  modalCardClass: () => "",
}));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("~/community/components/opportunities/LogoBlock", () => ({ LogoBlock: () => null }));
vi.mock("~/community/lib/block-color", () => ({ readLogoColor: () => "#112233" }));

import { OpportunityComposer } from "../OpportunityComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

function render(canPostJob: boolean, initialKind: "Job" | "ChatAsk") {
  act(() => {
    root.render(<OpportunityComposer open onClose={vi.fn()} initialKind={initialKind} canPostJob={canPostJob} />);
  });
}
function type(el: Element, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const field = (label: string) =>
  [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))!.querySelector("input, textarea")!;

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

describe("composer", () => {
  it("hides the Job tab from students and shows the coffee chat form", () => {
    render(false, "Job");
    expect(host.textContent).not.toContain("Job");
    expect(host.textContent).toContain("Ask for a coffee chat");
    expect(host.querySelector("[aria-label='Suggested topics']")).not.toBeNull();
  });

  it("shows the Job tab to alumni", () => {
    render(true, "Job");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Job");
    expect(host.textContent).toContain("Company");
  });

  it("keeps Post disabled until a job has company, role and message, then submits", () => {
    render(true, "Job");
    const post = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Post")!;
    expect(post().disabled).toBe(true);
    type(field("Company"), "Acme");
    type(field("Role"), "Designer");
    type(field("Message"), "Come work with us");
    expect(post().disabled).toBe(false);
    act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "create", kind: "Job", companyName: "Acme", role: "Designer", body: "Come work with us", willRefer: "false" }),
      { method: "post" },
    );
  });

  it("fills the topic from a chip and submits a chat ask", () => {
    render(false, "ChatAsk");
    act(() => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Resume review")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((field("Topic") as HTMLInputElement).value).toBe("Resume review");
    type(field("Message"), "Could you look at mine?");
    act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submit).toHaveBeenCalledWith(
      { intent: "create", kind: "ChatAsk", topic: "Resume review", body: "Could you look at mine?" },
      { method: "post" },
    );
  });
});
