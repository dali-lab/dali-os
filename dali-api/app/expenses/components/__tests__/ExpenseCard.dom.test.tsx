// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dialog = vi.hoisted(() => ({ confirm: vi.fn(), prompt: vi.fn(), choice: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => dialog }));
vi.mock("~/components/ui/floating", () => ({
  Select: ({ ariaLabel, value }: { ariaLabel?: string; value?: string }) => createElement("div", { "data-select": ariaLabel }, value),
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/ui/DateField", () => ({
  DateField: ({ value }: { value?: string }) => createElement("input", { "aria-label": "Date", defaultValue: value }),
}));

import { ExpenseCard } from "../ExpenseCard";
import type { CardOption, CategoryOption, ViewerSummary } from "../types";
import type { ExpenseActions } from "../useExpenseActions";
import { view } from "./fixtures";

let container: HTMLDivElement;
let root: Root;

const categories: CategoryOption[] = [{ id: "c1", label: "Technigala", chartString: null, hints: [], archived: false }];
const cards: CardOption[] = [
  { id: "k1", nickname: "Programs Visa", last4: "4821", ownerId: "o", ownerName: "Grace Hopper", holderIds: ["filer"], holderGroupIds: [], defaultCategoryId: null, archived: false },
];
const filer: ViewerSummary = { userId: "filer", isCore: false, isStaff: false, ownedCardIds: [] };

const makeActions = (over: Partial<ExpenseActions> = {}): ExpenseActions => ({
  submit: vi.fn(),
  busy: false,
  pendingIntent: null,
  error: null,
  result: null,
  ...over,
});

function mount(props: Partial<Parameters<typeof ExpenseCard>[0]> & { actions: ExpenseActions }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(ExpenseCard, {
        expense: view(),
        viewer: filer,
        cards,
        categories,
        onClose: () => {},
        ...props,
      }),
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
const text = () => container.textContent ?? "";
const click = (label: string) => act(() => button(label)!.click());

describe("ExpenseCard as the filer", () => {
  it("submits a complete draft", () => {
    const actions = makeActions();
    mount({ actions });
    click("Submit");
    expect(actions.submit).toHaveBeenCalledWith("submit", { id: "e1" });
  });

  it("shows blockers inline and does not submit an incomplete draft", () => {
    const actions = makeActions();
    mount({ actions, expense: view({ categoryId: null, merchant: null }) });
    click("Submit");
    expect(actions.submit).not.toHaveBeenCalled();
    const list = container.querySelector('[aria-label="Before you submit"]')!;
    expect(list.textContent).toContain("Add the merchant.");
    expect(list.textContent).toContain("Pick a category.");
  });

  it("shows the owner note for a staff card", () => {
    mount({ actions: makeActions(), expense: view({ paidWith: "STAFF_CARD", cardId: "k1" }) });
    expect(text()).toContain("Goes to Grace Hopper, who owns this card.");
  });

  it("saves only when something changed", () => {
    mount({ actions: makeActions() });
    expect(button("Save")!.disabled).toBe(true);
  });

  it("shows the checks and the extraction reason", () => {
    mount({
      actions: makeActions(),
      expense: view({
        checks: [
          { code: "itemized", level: "ok", message: "An itemized receipt is attached." },
          { code: "card_slip_only", level: "warning", message: "Only a card slip is attached." },
        ],
        suggestion: { categoryId: "c1", reason: "PO says Technigala" },
      }),
    });
    expect(text()).toContain("An itemized receipt is attached.");
    expect(text()).toContain("Only a card slip is attached.");
    expect(text()).toContain("PO says Technigala");
  });

  it("shows the returned note", () => {
    mount({ actions: makeActions(), expense: view({ status: "RETURNED", decisionNote: "Add the invoice.", approverName: "Grace Hopper" }) });
    expect(text()).toContain("Returned by Grace Hopper: Add the invoice.");
    expect(button("Submit")).toBeTruthy();
  });

  it("confirms before deleting a draft", async () => {
    dialog.confirm.mockResolvedValue(true);
    const actions = makeActions();
    mount({ actions });
    await act(async () => button("Delete draft")!.click());
    expect(dialog.confirm).toHaveBeenCalled();
    expect(actions.submit).toHaveBeenCalledWith("delete", { id: "e1" });
  });

  it("does not delete when the confirm is dismissed", async () => {
    dialog.confirm.mockResolvedValue(false);
    const actions = makeActions();
    mount({ actions });
    await act(async () => button("Delete draft")!.click());
    expect(actions.submit).not.toHaveBeenCalled();
  });

  it("shows a server error", () => {
    mount({ actions: makeActions({ error: "That charge is already matched." }) });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already matched");
  });

  it("offers withdraw on a submitted expense and nothing to edit", () => {
    const actions = makeActions();
    mount({ actions, expense: view({ status: "SUBMITTED" }) });
    expect(button("Submit")).toBeUndefined();
    click("Withdraw");
    expect(actions.submit).toHaveBeenCalledWith("withdraw", { id: "e1" });
  });

  it("says Got paid on an approved personal-card expense", () => {
    const actions = makeActions();
    mount({ actions, expense: view({ status: "APPROVED" }) });
    click("Got paid");
    expect(actions.submit).toHaveBeenCalledWith("mark-paid", { id: "e1" });
  });

  it("is read-only once paid", () => {
    mount({ actions: makeActions(), expense: view({ status: "PAID" }) });
    expect(button("Submit")).toBeUndefined();
    expect(button("Got paid")).toBeUndefined();
    expect(button("Close")).toBeTruthy();
  });

  it("shows the reason for a no-receipt expense", () => {
    mount({ actions: makeActions(), expense: view({ noReceipt: true, receipts: [], noReceiptReason: "Lost it", status: "SUBMITTED" }) });
    expect(text()).toContain("No receipt");
    expect(text()).toContain("Lost it");
  });
});

describe("ExpenseCard as an approver", () => {
  const staff: ViewerSummary = { userId: "staff", isCore: false, isStaff: true, ownedCardIds: [] };
  const submitted = () => view({ status: "SUBMITTED" });

  it("approves", () => {
    const actions = makeActions();
    mount({ actions, viewer: staff, expense: submitted() });
    click("Approve");
    expect(actions.submit).toHaveBeenCalledWith("decide", { id: "e1", decision: "approve" });
  });

  it("returns with the note typed in the prompt", async () => {
    dialog.prompt.mockResolvedValue("Add the invoice");
    const actions = makeActions();
    mount({ actions, viewer: staff, expense: submitted() });
    await act(async () => button("Return with note")!.click());
    expect(actions.submit).toHaveBeenCalledWith("decide", { id: "e1", decision: "return", note: "Add the invoice" });
  });

  it("asks for a note and sends nothing when the prompt is cancelled", async () => {
    dialog.prompt.mockResolvedValue(null);
    const actions = makeActions();
    mount({ actions, viewer: staff, expense: submitted() });
    await act(async () => button("Return with note")!.click());
    expect(dialog.prompt.mock.calls[0][0].validate("  ")).toBe("Add a note.");
    expect(actions.submit).not.toHaveBeenCalled();
  });

  it("cannot decide their own expense", () => {
    mount({ actions: makeActions(), viewer: { ...staff, userId: "filer" }, expense: submitted() });
    expect(button("Approve")).toBeUndefined();
  });

  it("gives other members no actions", () => {
    mount({ actions: makeActions(), viewer: { userId: "other", isCore: false, isStaff: false, ownedCardIds: [] }, expense: submitted() });
    expect(button("Approve")).toBeUndefined();
    expect(button("Withdraw")).toBeUndefined();
    expect(button("Close")).toBeTruthy();
  });

  it("lets staff mark a personal-card expense paid", () => {
    const actions = makeActions();
    mount({ actions, viewer: staff, expense: view({ status: "APPROVED" }) });
    click("Mark paid");
    expect(actions.submit).toHaveBeenCalledWith("mark-paid", { id: "e1" });
  });

  it("lets a card owner unmatch a matched charge", () => {
    const actions = makeActions();
    mount({
      actions,
      viewer: { userId: "o", isCore: false, isStaff: false, ownedCardIds: ["k1"] },
      expense: view({ status: "APPROVED", paidWith: "STAFF_CARD", cardId: "k1", matched: true, charge: { merchant: "GNOMON", postedAt: "2026-11-18", amountCents: 3687 } }),
    });
    expect(text()).toContain("Matched to GNOMON");
    click("Unmatch");
    expect(actions.submit).toHaveBeenCalledWith("unmatch-charge", { expenseId: "e1" });
  });
});

describe("ExpenseCard receipt preview", () => {
  const pdf = { id: "r2", kind: "ITEMIZED" as const, contentType: "application/pdf", url: "https://s3.example/r2", fileUrl: "/expenses/receipts/r2" };

  it("loads a PDF from this site, not storage, so the desktop app can show it", () => {
    mount({ actions: makeActions(), expense: view({ receipts: [pdf] }) });
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("/expenses/receipts/r2");
    expect(container.innerHTML).not.toContain("s3.example");
  });

  it("opens an image in the zoomable viewer", () => {
    mount({ actions: makeActions() });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="View Card slip larger"]')!.click());
    const viewer = document.body.querySelector('[role="dialog"]')!;
    expect(viewer.querySelector("img")?.getAttribute("src")).toBe("https://s3.example/r1");
    expect(viewer.querySelector('button[aria-label="Zoom in"]')).toBeTruthy();
  });

  it("links each receipt to its original in a new tab", () => {
    mount({ actions: makeActions() });
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Open in a new tab"]')!;
    expect(link.getAttribute("href")).toBe("/expenses/receipts/r1");
    expect(link.target).toBe("_blank");
  });

  it("steps through several receipts inside the viewer", () => {
    mount({ actions: makeActions(), expense: view({ receipts: [view().receipts[0], pdf] }) });
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Open viewer"]')!.click());
    act(() => document.body.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Next"]')!.click());
    expect(document.body.querySelector('[role="dialog"] iframe')?.getAttribute("src")).toBe("/expenses/receipts/r2");
  });
});
