// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toastError = vi.fn();
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: toastError }) }));

const { useImpersonateErrorToast } = await import("~/admin/components/useImpersonateErrorToast");

let container: HTMLDivElement;
let root: Root;

function Page() {
  useImpersonateErrorToast();
  const location = useLocation();
  return createElement("p", { "data-testid": "url" }, location.pathname + location.search);
}

async function render(url: string) {
  const Stub = createRoutesStub([{ path: "/admin/site-users", Component: Page }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub, { initialEntries: [url] })));
  return container.querySelector("[data-testid=url]")!.textContent;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  toastError.mockClear();
});

describe("useImpersonateErrorToast", () => {
  it("shows the failure and drops it from the url, keeping the search", async () => {
    const url = await render("/admin/site-users?q=ada&impersonateError=failed");
    expect(toastError).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith("Couldn't log in as that user. Try again.");
    expect(url).toBe("/admin/site-users?q=ada");
  });

  it("stays quiet for an unknown code or none", async () => {
    await render("/admin/site-users?impersonateError=bogus");
    act(() => root.unmount());
    container.remove();
    await render("/admin/site-users?q=ada");
    expect(toastError).not.toHaveBeenCalled();
  });
});
