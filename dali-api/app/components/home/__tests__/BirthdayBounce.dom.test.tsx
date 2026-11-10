// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BirthdayBounce, type BirthdayPerson } from "~/components/home/BirthdayBounce";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(people: BirthdayPerson[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(BirthdayBounce, { people }));
  });
  return host;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

const ada: BirthdayPerson = { id: "u1", name: "Ada Bates", photoUrl: "https://cdn.test/ada.jpg" };
const bo: BirthdayPerson = { id: "u2", name: "Bo Chen", photoUrl: null };

describe("BirthdayBounce", () => {
  it("renders nothing when nobody has a birthday", async () => {
    const el = await mount([]);
    expect(el.innerHTML).toBe("");
  });

  it("shows one bouncer per birthday person", async () => {
    const el = await mount([ada, bo]);
    expect(el.querySelectorAll('[data-testid="birthday-bouncer"]')).toHaveLength(2);
  });

  it("uses the profile photo when there is one", async () => {
    const el = await mount([ada]);
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.test/ada.jpg");
  });

  it("falls back to initials without a photo", async () => {
    const el = await mount([bo]);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("BC");
  });

  it("greets each person by first name and wears the hat", async () => {
    const el = await mount([ada]);
    expect(el.textContent).toContain("Happy birthday, Ada!");
    expect(el.querySelector("svg")).not.toBeNull();
  });

  it("keeps the overlay out of the way of clicks", async () => {
    const el = await mount([ada]);
    expect(el.firstElementChild?.className).toContain("pointer-events-none");
  });
});
