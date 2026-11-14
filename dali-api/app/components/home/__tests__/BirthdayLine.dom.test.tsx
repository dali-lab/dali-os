// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { BirthdayLine, type BirthdayPerson } from "~/components/home/BirthdayLine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(people: BirthdayPerson[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const router = createMemoryRouter([{ path: "/", element: createElement(BirthdayLine, { people }) }]);
  await act(async () => {
    root!.render(createElement(RouterProvider, { router }));
  });
  return host;
}

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  window.matchMedia = realMatchMedia;
});

const ada: BirthdayPerson = { id: "u1", name: "Ada Bates", photoUrl: "https://cdn.test/ada.jpg" };
const bo: BirthdayPerson = { id: "u2", name: "Bo Chen", photoUrl: null };
const cy: BirthdayPerson = { id: "u3", name: "Cy Diaz", photoUrl: null };
const dee: BirthdayPerson = { id: "u4", name: "Dee Eng", photoUrl: null };

describe("BirthdayLine", () => {
  it("renders nothing when nobody has a birthday", async () => {
    const el = await mount([]);
    expect(el.querySelector('[data-testid="birthday-line"]')).toBeNull();
    expect(el.querySelector("canvas")).toBeNull();
  });

  it("greets everyone by first name in one line", async () => {
    const el = await mount([ada, bo, cy]);
    expect(el.querySelector('[data-testid="birthday-line"]')?.textContent).toContain("Happy birthday, Ada, Bo and Cy");
  });

  it("links each name to that person's profile, with the full name on hover", async () => {
    const el = await mount([ada, bo]);
    const links = [...el.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("title")])).toEqual([
      ["Ada", "/members/u1", "Ada Bates"],
      ["Bo", "/members/u2", "Bo Chen"],
    ]);
  });

  it("shows photos or initials, at most three avatars, with the hat on the first", async () => {
    const el = await mount([ada, bo, cy, dee]);
    const avatars = el.querySelectorAll(".landing-birthday-avatar");
    expect(avatars).toHaveLength(3);
    expect(avatars[0].querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/ada.jpg");
    expect(avatars[1].textContent).toBe("BC");
    expect(avatars[0].querySelector("svg")).not.toBeNull();
    expect(avatars[1].querySelector("svg")).toBeNull();
    expect(el.querySelectorAll("a")).toHaveLength(4);
  });

  it("keeps the avatars out of the accessible name", async () => {
    const el = await mount([ada]);
    expect(el.querySelector(".landing-birthday-avatars")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("claims the day's confetti once, and never with reduced motion", async () => {
    await mount([ada]);
    expect(Object.keys(window.localStorage).some((k) => k.startsWith("dali:birthday-confetti:"))).toBe(true);

    await act(async () => root!.unmount());
    root = null;
    window.localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    await mount([ada]);
    expect(window.localStorage.length).toBe(0);
  });

  it("draws the burst over the whole window and cleans up when Home closes", async () => {
    const ctx = { setTransform: vi.fn(), clearRect: vi.fn() };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx as never);
    await mount([ada]);
    const canvas = document.body.querySelector(":scope > canvas.landing-confetti");
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => root!.unmount());
    root = null;
    expect(document.body.querySelector("canvas")).toBeNull();
  });
});
