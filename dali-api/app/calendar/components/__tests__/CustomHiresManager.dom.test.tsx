// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import { CustomHiresManager } from "~/calendar/components/CustomHiresManager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onArchive = vi.fn();
let resolveFetch: (r: Response) => void;
const fetchMock = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function mount(hires = [{ id: "h1", label: "Library desk" }]) {
  const Stub = createRoutesStub([
    {
      path: "/",
      loader: () => null,
      Component: () => createElement(CustomHiresManager, { hires, onArchive }),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(ToastProvider, null, createElement(Stub, { initialEntries: ["/"] }))));
  await act(async () => {});
  await act(async () => container.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!.click());
}

const chips = () => Array.from(document.body.querySelectorAll("li")).map((li) => li.textContent?.trim());

async function addRole(text: string) {
  const input = document.body.querySelector<HTMLInputElement>("input[type='text']")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.body.querySelector<HTMLFormElement>("form")!.requestSubmit());
}

beforeEach(() => {
  onArchive.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolveFetch = r)));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("CustomHiresManager", () => {
  it("shows a new role as a chip before the server answers", async () => {
    await mount();
    await addRole("Dining hall");
    expect(chips()).toEqual(["Library desk", "Dining hall"]);
    expect(document.body.querySelector<HTMLButtonElement>("button[aria-label='Remove Dining hall']")!.disabled).toBe(true);
  });

  it("takes the chip back and puts the text back in the box when the add fails", async () => {
    await mount();
    await addRole("Dining hall");
    await act(async () => resolveFetch(json({ error: "Too many roles" }, 400)));
    expect(chips()).toEqual(["Library desk"]);
    expect(document.body.querySelector<HTMLInputElement>("input[type='text']")!.value).toBe("Dining hall");
    expect(document.body.textContent).toContain("Too many roles");
  });

  it("hands a removal to the caller from the chip's remove button", async () => {
    await mount();
    await act(async () => {
      document.body
        .querySelector("button[aria-label='Remove Library desk']")!
        .dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    });
    expect(onArchive).toHaveBeenCalledWith({ id: "h1", label: "Library desk" });
  });
});
