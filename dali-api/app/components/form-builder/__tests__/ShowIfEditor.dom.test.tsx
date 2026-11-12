// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const fetcher = vi.hoisted(() => ({
  submit: vi.fn(),
  data: undefined as unknown,
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({ data: fetcher.data, submit: fetcher.submit, state: "idle" }),
}));
vi.mock("~/components/os-chrome", () => ({ useOsChrome: () => ({ formTrigger: "" }) }));

import { ShowIfEditor } from "~/components/form-builder/ShowIfEditor";
import { OTHER_VALUE, questionNumbers } from "~/lib/form-logic";
import type { Question, ShowIfRule } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

const q = (key: string, type: Question["type"], data: Partial<Question["data"]> = {}): Question => ({
  key,
  type,
  required: false,
  data: { label: key, ...data },
});
const yesNo = q("returning", "radio", { options: ["Yes", "No"], allowOther: true });
const rating = q("rating", "scale");
const own = q("why", "textarea");

function render(
  questions: Question[],
  showIf?: ShowIfRule,
  extra: Partial<Parameters<typeof ShowIfEditor>[0]> = {},
) {
  act(() => {
    root.render(
      createElement(ShowIfEditor, {
        subject: "question",
        questions,
        ownKey: extra.ownKey ?? "why",
        showIf,
        onChange,
        numbers: questionNumbers(questions),
        ...extra,
      }),
    );
  });
}

const text = () => container.textContent ?? "";
const radio = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label)!;
const triggers = (label: string) => [...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)];
const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
async function choose(label: string, option: string, index = 0) {
  await click(triggers(label)[index]);
  const item = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim().startsWith(option));
  if (!item) throw new Error(`No option "${option}" in ${label}`);
  await click(item);
}
const lastRule = () => onChange.mock.calls.at(-1)?.[0];

beforeEach(() => {
  onChange.mockReset();
  fetcher.submit.mockReset();
  fetcher.data = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ShowIfEditor", () => {
  it("can't turn on without an earlier question", () => {
    render([own, yesNo]);
    expect(radio("Only when").disabled).toBe(true);
    expect(text()).toContain("There is no earlier question to depend on.");
  });

  it("starts a rule on the nearest earlier question", async () => {
    render([yesNo, rating, own]);
    await click(radio("Only when"));
    expect(lastRule()).toEqual({
      match: "all",
      conditions: [{ questionKey: "rating", op: "is", values: ["1"] }],
    });
  });

  it("clears the rule on Always", async () => {
    render([yesNo, own], { questionKey: "returning", op: "is", value: "No" });
    await click(radio("Always"));
    expect(lastRule()).toBeUndefined();
  });

  it("says why a question or page read by staffing is always shown", () => {
    render([yesNo, own], undefined, { lockedBy: "Project Bids" });
    expect(radio("Only when").disabled).toBe(true);
    expect(text()).toContain("Project Bids reads this answer, so the question is always shown.");
    render([yesNo, q("p", "pageBreak")], undefined, { subject: "page", ownKey: "p", lockedBy: "Level Up" });
    expect(text()).toContain("Show this page");
    expect(text()).toContain("Level Up reads an answer on this page, so the page is always shown.");
  });

  it("offers every earlier answerable question, but no skills rating, later question or unloadable list", async () => {
    render(
      [
        yesNo,
        q("skills", "skills_rating"),
        q("site", "github_url"),
        q("proj", "reference"),
        own,
        q("later", "select", { options: ["X"] }),
      ],
      { questionKey: "returning", op: "is", value: "No" },
    );
    await click(triggers("Question")[0]);
    const listed = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(listed).toEqual(["Q1 returning", "Q3 site"]);
  });

  it("reads a rule saved as one condition and writes the new shape", async () => {
    render([yesNo, own], { questionKey: "returning", op: "is", value: "No" });
    expect(triggers("Answers")[0].textContent).toContain("No");
    await choose("Answers", "Yes");
    expect(lastRule()).toEqual({
      match: "all",
      conditions: [{ questionKey: "returning", op: "is", values: ["No", "Yes"] }],
    });
  });

  it("offers Other when the source allows a write-in", async () => {
    render([yesNo, own], { questionKey: "returning", op: "is", value: "No" });
    await choose("Answers", "Other");
    expect(lastRule().conditions[0].values).toEqual(["No", OTHER_VALUE]);
  });

  it("keeps the answers when the operator takes the same input, and resets them when it doesn't", async () => {
    render([rating, own], { match: "all", conditions: [{ questionKey: "rating", op: "is", values: ["2", "4"] }] });
    await choose("Condition", "is not");
    expect(lastRule().conditions[0]).toEqual({ questionKey: "rating", op: "isNot", values: ["2", "4"] });
    await choose("Condition", "is at most");
    expect(lastRule().conditions[0]).toEqual({ questionKey: "rating", op: "atMost", values: ["3"] });
    await choose("Condition", "is blank");
    expect(lastRule().conditions[0]).toEqual({ questionKey: "rating", op: "blank", values: [] });
  });

  it("shows the input that fits each condition", () => {
    const form = [rating, q("n", "number"), q("d", "date"), q("t", "text"), q("f", "file"), own];
    render(form, {
      match: "all",
      conditions: [
        { questionKey: "rating", op: "atLeast", values: ["4"] },
        { questionKey: "n", op: "atMost", values: ["10"] },
        { questionKey: "d", op: "atLeast", values: ["2027-01-01"] },
        { questionKey: "t", op: "contains", values: ["react"] },
        { questionKey: "f", op: "answered", values: [] },
      ],
    });
    expect(triggers("Answer")[0].textContent).toContain("4");
    expect(triggers("Number")).toHaveLength(0);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Number"]')!.value).toBe("10");
    expect(triggers("Date")).toHaveLength(1);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Text"]')!.value).toBe("react");
    expect(triggers("Answers")).toHaveLength(0);
  });

  it("adds a condition, picks how they combine, and removes them", async () => {
    render([yesNo, rating, own], { questionKey: "returning", op: "is", value: "No" });
    expect(text()).not.toContain("of these match");
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Add condition")!);
    expect(lastRule()).toEqual({
      match: "all",
      conditions: [
        { questionKey: "returning", op: "is", values: ["No"] },
        { questionKey: "rating", op: "is", values: ["1"] },
      ],
    });

    render([yesNo, rating, own], lastRule());
    expect(text()).toContain("of these match");
    await choose("How conditions combine", "any");
    expect(lastRule().match).toBe("any");

    await click(triggers("Remove condition")[0]);
    expect(lastRule()).toEqual({ match: "all", conditions: [{ questionKey: "rating", op: "is", values: ["1"] }] });

    render([yesNo, rating, own], { questionKey: "returning", op: "is", value: "No" });
    await click(triggers("Remove condition")[0]);
    expect(lastRule()).toBeUndefined();
  });

  it("loads a Database list's rows and keeps the picked labels", async () => {
    const proj = q("proj", "reference", { referenceSource: "projects:open" });
    render([proj, own], { match: "all", conditions: [{ questionKey: "proj", op: "is", values: [] }] }, { formId: "form-1" });
    expect(fetcher.submit).toHaveBeenCalledTimes(1);
    const [fd, opts] = fetcher.submit.mock.calls[0];
    expect(opts).toEqual({ method: "post", action: "/forms/preview-resolve" });
    expect((fd as FormData).get("formId")).toBe("form-1");
    expect(JSON.parse((fd as FormData).get("questions") as string)[0].key).toBe("proj");

    fetcher.data = {
      ok: true,
      questions: [{ ...proj, data: { ...proj.data, referenceOptions: [{ value: "p1", label: "Atlas" }] } }],
    };
    render([proj, own], { match: "all", conditions: [{ questionKey: "proj", op: "is", values: [] }] }, { formId: "form-1" });
    await choose("Answers", "Atlas");
    expect(lastRule().conditions[0]).toEqual({ questionKey: "proj", op: "is", values: ["p1"], labels: ["Atlas"] });
  });

  it("shows the problem under the rule", () => {
    render([yesNo, own], { questionKey: "returning", op: "is", value: "Maybe" }, { problem: "Something is off." });
    expect(text()).toContain("Something is off.");
  });
});
