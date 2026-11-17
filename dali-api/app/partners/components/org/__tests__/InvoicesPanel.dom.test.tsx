// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Select: ({ value, options, onChange, ariaLabel }: any) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { InvoicesPanel } = await import("../InvoicesPanel");

const invoice = {
  id: "inv1",
  amountCents: 5000,
  status: "Issued" as const,
  issuedAt: null,
  dueAt: null,
  paidAt: null,
  reference: null,
  note: null,
};

let container: HTMLDivElement;
let root: Root;

async function mount(canEdit: boolean, action: (args: { request: Request }) => unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <InvoicesPanel orgId="org1" invoices={[invoice]} canEdit={canEdit} />,
      loader: () => null,
      action: action as never,
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(ToastProvider, null, createElement(Stub, { initialEntries: ["/"] }))),
  );
  await act(async () => {});
}

async function choose(value: string) {
  const select = container.querySelector("select")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {});
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("InvoicesPanel status change", () => {
  it("posts the intent, invoice id and status to the route action without reloading", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const seen: Record<string, string>[] = [];
    await mount(true, async ({ request }) => {
      const fd = await request.formData();
      seen.push(Object.fromEntries(fd.entries()) as Record<string, string>);
      return { ok: true };
    });
    await choose("Paid");
    expect(seen).toEqual([{ intent: "invoice-status", invoiceId: "inv1", status: "Paid" }]);
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows a toast when the action returns an error", async () => {
    await mount(true, async () => ({ error: "Invalid invoice status update." }));
    await choose("Void");
    expect(document.body.textContent).toContain("Invalid invoice status update.");
  });

  it("renders the status as text when the viewer cannot edit", async () => {
    await mount(false, async () => ({ ok: true }));
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).toContain("Issued");
  });
});
