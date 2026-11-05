// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { StartReturnModal } from "../StartReturnModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let posted: FormData[];
let reply: Record<string, unknown>;

async function mount(onCreated = vi.fn()) {
  posted = [];
  const Page = () =>
    createElement(StartReturnModal, {
      projects: [
        { id: "old", name: "Research Computing Dashboard", lastTermCode: "26S" },
        { id: "us", name: "Ultrasound Education", lastTermCode: "26F" },
      ],
      terms: [
        { id: "t27w", code: "27W" },
        { id: "t27s", code: "27S" },
      ],
      defaultTermId: "t27w",
      onCreated,
      onClose: () => {},
    });
  const Stub = createRoutesStub([
    { path: "/", Component: Page, loader: () => null },
    {
      path: "/core/partners/planning",
      action: async ({ request }) => {
        posted.push(await request.formData());
        return reply;
      },
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub, { initialEntries: ["/"] })));
  await act(async () => {});
  return onCreated;
}

const button = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === text)!;

async function pickProject(label: string) {
  const input = document.body.querySelector<HTMLInputElement>("input[aria-label='Past project']")!;
  await act(async () => input.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const option = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button[role='option']")).find((o) =>
    o.textContent?.includes(label),
  )!;
  await act(async () => option.click());
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("StartReturnModal", () => {
  it("lists past projects with the term they last ran", async () => {
    await mount();
    const input = document.body.querySelector<HTMLInputElement>("input[aria-label='Past project']")!;
    await act(async () => input.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.body.textContent).toContain("Research Computing Dashboard (last ran 26S)");
  });

  it("waits for a project before it can start", async () => {
    await mount();
    expect(button("Start return").disabled).toBe(true);
  });

  it("posts the project and the default term, then hands back the new application", async () => {
    reply = { ok: true, applicationId: "app-9" };
    const onCreated = await mount();
    await pickProject("Research Computing Dashboard");
    await act(async () => button("Start return").click());
    await act(async () => {});
    expect(posted).toHaveLength(1);
    expect(posted[0].get("intent")).toBe("start-return");
    expect(posted[0].get("projectId")).toBe("old");
    expect(posted[0].getAll("targetTermId")).toEqual(["t27w"]);
    expect(onCreated).toHaveBeenCalledWith("app-9");
  });

  it("shows the server's reason when a return can't start", async () => {
    reply = { error: "This project already has an open return on the partner board." };
    const onCreated = await mount();
    await pickProject("Ultrasound Education");
    await act(async () => button("Start return").click());
    await act(async () => {});
    expect(document.body.textContent).toContain("already has an open return");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
