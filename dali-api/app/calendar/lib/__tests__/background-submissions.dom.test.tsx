// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));

import { useBackgroundSubmissionToasts, useSubmitBackground } from "~/calendar/lib/background-submissions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Popover({ onClose }: { onClose: () => void }) {
  const submitBackground = useSubmitBackground();
  return createElement(
    "button",
    {
      onClick: () => {
        submitBackground("event-move", { intent: "event-move", eventId: "e1" });
        onClose();
      },
    },
    "save",
  );
}

function Page({ onSuccess }: { onSuccess?: () => string | null }) {
  const [open, setOpen] = useState(true);
  useBackgroundSubmissionToasts(onSuccess);
  return open ? createElement(Popover, { onClose: () => setOpen(false) }) : createElement("p", null, "closed");
}

async function mount(action: () => Response | Promise<Response>, onSuccess?: () => string | null) {
  const router = createMemoryRouter(
    [{ path: "/", element: createElement(Page, { onSuccess }), loader: () => null, action }],
    { initialEntries: ["/"] },
  );
  await act(async () => root.render(createElement(RouterProvider, { router })));
  return router;
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => act(() => root.unmount()));

describe("background writes", () => {
  it("toast a failure after the submitting component has unmounted", async () => {
    await mount(() => Response.json({ error: "Room taken" }, { status: 400 }));
    await act(async () => container.querySelector("button")!.click());
    await settle();
    expect(container.textContent).toBe("closed");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't move the event. Room taken");
  });

  it("toast a failure once, not on every render after", async () => {
    await mount(() => Response.json({ error: "Room taken" }, { status: 500 }));
    await act(async () => container.querySelector("button")!.click());
    await settle();
    await settle();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("report success through the callback and never as a failure", async () => {
    const onSuccess = vi.fn(() => "Done.");
    await mount(() => Response.json({ ok: true }), onSuccess);
    await act(async () => container.querySelector("button")!.click());
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Done.");
  });
});
