import { describe, expect, it } from "vitest";
import { cardLabel, dayInputValue, formatDay, paidWithLabel, statusPill } from "../format";
import { TAB_LABELS, expenseStats, filterRows, tabHref } from "../page-model";
import { exportHref } from "../export-link";
import { row } from "./fixtures";

describe("statusPill", () => {
  it.each([
    ["DRAFT", "OWN_CARD", false, "Draft"],
    ["SUBMITTED", "OWN_CARD", false, "Waiting on approval"],
    ["RETURNED", "OWN_CARD", false, "Returned"],
    ["PAID", "OWN_CARD", false, "Paid"],
    ["APPROVED", "OWN_CARD", false, "Approved, not paid yet"],
    ["APPROVED", "STAFF_CARD", false, "Approved"],
    ["APPROVED", "STAFF_CARD", true, "Matched"],
  ] as const)("%s on %s (matched %s) reads %s", (status, paidWith, matched, label) => {
    expect(statusPill({ status, paidWith, matched }).label).toBe(label);
  });
});

describe("dates and labels", () => {
  it("formats a day without shifting time zones", () => {
    expect(formatDay("2026-11-17")).toBe("Nov 17, 2026");
    expect(formatDay(new Date("2026-01-01T00:00:00Z"))).toBe("Jan 1, 2026");
  });
  it("handles missing and bad dates", () => {
    expect(formatDay(null)).toBe("No date");
    expect(formatDay("soon")).toBe("No date");
    expect(dayInputValue(null)).toBe("");
    expect(dayInputValue("2026-11-17T00:00:00.000Z")).toBe("2026-11-17");
  });
  it("labels cards and payment", () => {
    expect(cardLabel({ nickname: "Programs Visa", last4: "4821" })).toBe("Programs Visa ··4821");
    expect(paidWithLabel("OWN_CARD", null)).toBe("Personal card");
    expect(paidWithLabel("STAFF_CARD", { nickname: "P", last4: "1" })).toBe("P ··1");
    expect(paidWithLabel(null, null)).toBe("Not chosen");
  });
});

describe("page model", () => {
  it("links the first tab to the bare page", () => {
    expect(tabHref("yours")).toBe("/expenses");
    expect(tabHref("approvals")).toBe("/expenses?tab=approvals");
    expect(Object.keys(TAB_LABELS)).toEqual(["yours", "approvals", "all", "cards"]);
  });
  it("filters by how it was paid", () => {
    const rows = [row({ id: "a", paidWith: "OWN_CARD" }), row({ id: "b", paidWith: "STAFF_CARD" })];
    expect(filterRows(rows, "all")).toHaveLength(2);
    expect(filterRows(rows, "STAFF_CARD").map((r) => r.id)).toEqual(["b"]);
  });
  it("counts waiting expenses and what is owed on personal cards", () => {
    const stats = expenseStats([
      row({ status: "SUBMITTED" }),
      row({ status: "APPROVED", paidWith: "OWN_CARD", totalCents: 1000 }),
      row({ status: "APPROVED", paidWith: "OWN_CARD", totalCents: 250 }),
      row({ status: "APPROVED", paidWith: "STAFF_CARD", totalCents: 9999 }),
      row({ status: "PAID", paidWith: "OWN_CARD", totalCents: 5000 }),
    ]);
    expect(stats).toEqual({ waiting: 1, owedCents: 1250 });
  });
});

describe("exportHref", () => {
  it("carries only the filters that are set", () => {
    const href = exportHref("csv", "all", new URLSearchParams("tab=all&status=APPROVED&cardId=k1&junk=1&expense=e1"));
    const url = new URL(href, "https://os.example");
    expect(url.pathname).toBe("/expenses/export");
    expect(Object.fromEntries(url.searchParams)).toEqual({ format: "csv", scope: "all", status: "APPROVED", cardId: "k1" });
  });
  it("builds the pdf link", () => {
    expect(exportHref("pdf", "all", new URLSearchParams())).toBe("/expenses/export?format=pdf&scope=all");
  });
});
