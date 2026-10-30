// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import type { Peer } from "../PresenceProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let peers: Peer[] = [];
vi.mock("../PresenceProvider", () => ({
  usePresence: () => ({ peers, connected: true, followPeer: () => {} }),
}));

const { PresenceBar } = await import("../PresenceBar");

const me: Peer = { clientId: 1, name: "Ada Lovelace", color: "#000", idle: false, isMe: true, userId: "u-ada" };
const ada = (clientId: number, extra: Partial<Peer> = {}): Peer => ({
  clientId,
  name: "Ada Lovelace",
  color: "#000",
  idle: false,
  isMe: false,
  userId: "u-ada",
  photoUrl: "https://example.edu/ada.jpg",
  ...extra,
});
const agent = (extra: Partial<Peer> = {}): Peer =>
  ada(99, {
    name: "Claude",
    color: "#d97757",
    photoUrl: null,
    subtitle: "Ada Lovelace's agent",
    agent: { kind: "claude", action: "editing" },
    ...extra,
  });

let container: HTMLDivElement;
let root: Root;

function mount(list: Peer[]) {
  peers = list;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, null, createElement(PresenceBar))));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const chips = () => [...container.querySelectorAll<HTMLElement>("span.rounded-full.overflow-hidden")];

function hover(chip: HTMLElement) {
  act(() => {
    chip.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
}

describe("PresenceBar agent chips", () => {
  it("shows the agent's logo, not its owner's photo", () => {
    mount([me, agent()]);
    const chip = chips()[1]!;
    expect(chip.querySelector("[data-agent='claude']")).not.toBeNull();
    expect(chip.querySelector("img")).toBeNull();
  });

  it("keeps the agent separate from its owner, who shares the userId", () => {
    mount([{ ...me, userId: "u-me" }, ada(2), agent()]);
    expect(chips()).toHaveLength(3);
    expect(container.querySelectorAll("[data-agent]")).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("still shows the bar when your own agent is the only other presence", () => {
    mount([me, agent()]);
    expect(chips()).toHaveLength(2);
  });

  it("says on hover what the agent is doing and whose it is, linking to the owner", () => {
    mount([me, agent({ agent: { kind: "claude", action: "reading" } })]);
    hover(chips()[1]!);
    const card = container.querySelector("[role='tooltip']")!;
    expect(card.textContent).toContain("Claude · reading");
    expect(card.textContent).toContain("Ada Lovelace's agent");
    expect(card.textContent).not.toContain("idle");
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/members/u-ada");
  });

  it("labels the chip link as the agent, not as the owner's profile", () => {
    mount([me, agent()]);
    const link = chips()[1]!.closest("a")!;
    expect(link.getAttribute("aria-label")).toBe("Claude, Ada Lovelace's agent");
  });

  it("renders a member chip exactly as before", () => {
    const grace = ada(2, { name: "Grace Hopper", userId: "u-grace", idle: true });
    mount([{ ...me, userId: "u-me", name: "Me" }, grace]);
    const link = chips()[1]!.closest("a")!;
    expect(link.getAttribute("aria-label")).toBe("View Grace Hopper's profile");
    expect(chips()[1]!.querySelector("img")?.getAttribute("src")).toBe("https://example.edu/ada.jpg");
    hover(chips()[1]!);
    expect(container.querySelector("[role='tooltip']")!.textContent).toContain("Grace Hopper · idle");
  });
});
