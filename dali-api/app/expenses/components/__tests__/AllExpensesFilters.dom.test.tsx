// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { click, getButton, renderDom } from "~/test-utils/render";
import { AllExpensesFilters, activeFilterCount, toggleListValue } from "../AllExpensesFilters";

const cards = [{ id: "c1", nickname: "Design", last4: "4242" }] as never[];
const categories = [{ id: "cat1", label: "Food" }] as never[];
const terms = [{ id: "t1", code: "26F" }];

function mount(query: string) {
  const onChange = vi.fn();
  const { container } = renderDom(
    <AllExpensesFilters params={new URLSearchParams(query)} onChange={onChange} cards={cards} categories={categories} terms={terms} />,
  );
  return { container, onChange };
}

function openPanel(container: HTMLElement) {
  click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Filters"))!);
  return document.querySelector<HTMLElement>("[aria-label='Filters']")!;
}

describe("activeFilterCount", () => {
  it("counts each filter key with a value once", () => {
    expect(activeFilterCount(new URLSearchParams("status=DRAFT,PAID&cardId=c1&noReceipt=1"))).toBe(3);
  });

  it("ignores params that aren't filters", () => {
    expect(activeFilterCount(new URLSearchParams("tab=all&expense=e1"))).toBe(0);
  });
});

describe("toggleListValue", () => {
  it("adds a value to the list", () => {
    expect(toggleListValue("DRAFT", "PAID")).toBe("DRAFT,PAID");
  });

  it("removes a value already in the list", () => {
    expect(toggleListValue("DRAFT,PAID", "DRAFT")).toBe("PAID");
  });

  it("clears the param when the last value goes", () => {
    expect(toggleListValue("DRAFT", "DRAFT")).toBeNull();
    expect(toggleListValue(null, "DRAFT")).toBe("DRAFT");
  });
});

describe("AllExpensesFilters", () => {
  it("shows how many filters are on in the trigger", () => {
    const { container } = mount("status=RETURNED&termId=t1");
    const trigger = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Filters"))!;
    expect(trigger.textContent).toBe("Filters2");
  });

  it("marks the selected status, card and term pills", () => {
    const { container } = mount("status=RETURNED&cardId=c1&termId=t1");
    const panel = openPanel(container);
    expect(getButton(panel, "Returned").getAttribute("aria-pressed")).toBe("true");
    expect(getButton(panel, "Paid").getAttribute("aria-pressed")).toBe("false");
    expect(getButton(panel, "Design ··4242").getAttribute("aria-pressed")).toBe("true");
    expect(getButton(panel, "26F").getAttribute("aria-pressed")).toBe("true");
  });

  it("adds a status to the existing selection", () => {
    const { container, onChange } = mount("status=RETURNED");
    click(getButton(openPanel(container), "Paid"));
    expect(onChange).toHaveBeenCalledWith({ status: "RETURNED,PAID" });
  });

  it("clears a single-value filter when its selected pill is pressed again", () => {
    const { container, onChange } = mount("categoryId=cat1");
    click(getButton(openPanel(container), "Food"));
    expect(onChange).toHaveBeenCalledWith({ categoryId: null });
  });

  it("resets every filter at once", () => {
    const { container, onChange } = mount("status=DRAFT&outstanding=1");
    click(getButton(openPanel(container), "Reset"));
    expect(onChange).toHaveBeenCalledWith({
      status: null,
      cardId: null,
      categoryId: null,
      termId: null,
      from: null,
      to: null,
      noReceipt: null,
      outstanding: null,
    });
  });

  it("hides the Reset button when nothing is filtered", () => {
    const { container } = mount("");
    const panel = openPanel(container);
    expect(Array.from(panel.querySelectorAll("button")).some((b) => b.textContent === "Reset")).toBe(false);
  });

  it("keeps the export links carrying the current filters", () => {
    const { container } = mount("status=PAID");
    const csv = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.includes("Export CSV"))!;
    expect(csv.getAttribute("href")).toContain("status=PAID");
  });
});
