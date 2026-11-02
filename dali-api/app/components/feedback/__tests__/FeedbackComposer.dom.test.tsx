// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { useFeedbackComposer } from "~/components/feedback/FeedbackComposer";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function Host({ id, pagePath }: { id: string; pagePath: string }) {
  const composer = useFeedbackComposer({ pagePath, fetcherKey: `test-${id}` });
  return createElement(
    "div",
    null,
    createElement("button", { onClick: composer.compose }, `Open ${id}`),
    composer.ui,
  );
}

async function mount(action: (form: FormData) => void) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(Host, { id: "page", pagePath: "" }),
          createElement(Host, { id: "shell", pagePath: "/projects" }),
        ),
    },
    {
      path: "/feedback",
      action: async ({ request }) => {
        action(await request.formData());
        return { ok: true };
      },
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub, { initialEntries: ["/"] })));
}

async function write(text: string) {
  const area = document.querySelector("textarea") as HTMLTextAreaElement;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const open = (id: string) =>
  act(async () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === `Open ${id}`)!.click(),
  );

describe("useFeedbackComposer", () => {
  it("posts with the mount's page path and shows one toast with two mounts present", async () => {
    const posted = vi.fn();
    await mount((form) => posted(form.get("pagePath"), form.get("body")));
    await open("page");
    await write("A request");
    const post = [...document.querySelectorAll("button")].find((b) => b.textContent === "Post")!;
    await act(async () => post.click());
    await vi.waitFor(() => expect(posted).toHaveBeenCalledWith("", "A request"));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Feedback posted"));
    expect(document.body.textContent!.match(/Feedback posted/g)).toHaveLength(1);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
