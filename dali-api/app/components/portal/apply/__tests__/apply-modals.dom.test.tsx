// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { click, getButton, renderDom } from "~/test-utils/render";
import { ApplyReviewModal, type ApplyReviewModalProps } from "~/components/portal/apply/ApplyReviewModal";
import { UrlWarningModal } from "~/components/portal/apply/UrlWarningModal";
import { ChallengeSwitchModal } from "~/components/portal/apply/ChallengeSwitchModal";
import { WaitlistedModal } from "~/components/portal/apply/WaitlistedModal";
import type { DomainShape } from "~/hiring/lib/apply-sections";
import type { Question } from "~/types";

const q = (key: string, label: string): Question => ({ key, type: "text", required: false, data: { label } }) as Question;
const domains: DomainShape[] = [
  { id: "dev", name: "Development", challenges: [{ challengeVersionId: "cv1", challengeName: "Build a site", description: null, questions: [q("devq", "Dev question")] }] },
  { id: "design", name: "Design", closed: true, challenges: [{ challengeVersionId: "cv2", challengeName: "Make a logo", description: null, questions: [q("desq", "Design question")] }] },
  { id: "pm", name: "Product", challenges: [{ challengeVersionId: "cv3", challengeName: "Write a spec", description: null, questions: [q("pmq", "Product question")] }] },
];

const reviewProps = (over: Partial<ApplyReviewModalProps> = {}): ApplyReviewModalProps => ({
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  submitting: false,
  isAlreadySubmitted: false,
  startTermOptions: [],
  startTermId: null,
  selectedDomainIds: ["dev", "design"],
  domains,
  closedDomainIds: new Set(["design"]),
  formQuestions: [q("why", "Why DALI?")],
  answers: { why: "To build" },
  domainAnswers: { dev: { devq: "Dev answer" }, design: { desq: "Design answer" }, pm: { pmq: "Product answer" } },
  pickedChallengeByDomain: { dev: "cv1", design: "cv2", pm: "cv3" },
  continuedFrom: {},
  continuedInterest: null,
  continuedAnswers: {},
  ...over,
});
const text = () => document.body.textContent ?? "";

describe("ApplyReviewModal", () => {
  it("lists only the selected domains and their answers", () => {
    renderDom(createElement(ApplyReviewModal, reviewProps()));
    expect(text()).toContain("Development, Design");
    expect(text()).toContain("Dev answer");
    expect(text()).toContain("Design answer");
    expect(text()).not.toContain("Product");
    expect(text()).not.toContain("Product answer");
  });

  it("says closed domains are not resubmitted", () => {
    renderDom(createElement(ApplyReviewModal, reviewProps()));
    expect(text()).toContain("Submitting now: Development. Design is closed and under review, not resubmitted.");
  });

  it("shows the general answers and 'None selected' without domains", () => {
    renderDom(createElement(ApplyReviewModal, reviewProps({ selectedDomainIds: [] })));
    expect(text()).toContain("None selected");
    expect(text()).toContain("To build");
  });

  it("shows the picked start term when the cycle offers a choice", () => {
    renderDom(createElement(ApplyReviewModal, reviewProps({ startTermOptions: [{ id: "t1", code: "27W" }], startTermId: "t1" })));
    expect(text()).toContain("Start term");
    expect(text()).not.toContain("Not selected");
  });

  it("words the title and buttons for a first submission and for an update", () => {
    const first = renderDom(createElement(ApplyReviewModal, reviewProps()));
    expect(text()).toContain("Review your application");
    expect(getButton(document.body, "Confirm Submission")).toBeTruthy();
    first.unmount();
    renderDom(createElement(ApplyReviewModal, reviewProps({ isAlreadySubmitted: true })));
    expect(text()).toContain("Review your changes");
  });

  it("confirms and goes back through its callbacks, and disables both while submitting", () => {
    const props = reviewProps();
    const view = renderDom(createElement(ApplyReviewModal, props));
    click(getButton(document.body, "Confirm Submission"));
    click(getButton(document.body, "Go Back and Edit"));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    renderDom(createElement(ApplyReviewModal, reviewProps({ submitting: true })));
    expect(getButton(document.body, "Submitting...").disabled).toBe(true);
    expect(getButton(document.body, "Go Back and Edit").disabled).toBe(true);
  });

  it("renders nothing when closed", () => {
    renderDom(createElement(ApplyReviewModal, reviewProps({ open: false })));
    expect(text()).not.toContain("Review your application");
  });
});

describe("UrlWarningModal", () => {
  const base = { open: true, onFix: vi.fn(), onSubmitAnyway: vi.fn(), submitting: false, formQuestions: [q("repo", "Repository")], domains };

  it("names the question behind each warning, falling back to the key", () => {
    renderDom(createElement(UrlWarningModal, { ...base, urlWarnings: { repo: "Looks private", devq: "Not found", mystery: "Odd" } }));
    expect(text()).toContain("Repository: Looks private");
    expect(text()).toContain("Dev question: Not found");
    expect(text()).toContain("mystery: Odd");
  });

  it("goes back to fix or submits anyway through its callbacks", () => {
    const props = { ...base, onFix: vi.fn(), onSubmitAnyway: vi.fn(), urlWarnings: { repo: "x" } };
    renderDom(createElement(UrlWarningModal, props));
    click(getButton(document.body, "Go Back and Fix"));
    click(getButton(document.body, "Submit Anyway"));
    expect(props.onFix).toHaveBeenCalledTimes(1);
    expect(props.onSubmitAnyway).toHaveBeenCalledTimes(1);
  });
});

describe("ChallengeSwitchModal", () => {
  it("cancels or confirms the switch", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderDom(createElement(ChallengeSwitchModal, { open: true, onCancel, onConfirm }));
    click(getButton(document.body, "Cancel"));
    click(getButton(document.body, "Switch and Clear Answers"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("WaitlistedModal", () => {
  const options = [
    { domainApplicationId: "da1", domainId: "dev", domainName: "Development", cycleName: "Fall", waitlistedAt: "2026-03-04T00:00:00Z" },
    { domainApplicationId: "da2", domainId: "pm", domainName: "Product", cycleName: "Fall", waitlistedAt: "2026-03-04T00:00:00Z" },
  ] as never;

  it("marks a domain already in use and picks the others", () => {
    const onReuse = vi.fn();
    renderDom(createElement(WaitlistedModal, { open: true, onClose: vi.fn(), reusing: false, options, continuedFrom: { dev: "Fall" }, onReuse }));
    expect(text()).toContain("In use");
    const buttons = Array.from(document.body.querySelectorAll("li button")) as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(true);
    click(buttons[1]);
    expect(onReuse).toHaveBeenCalledWith(expect.objectContaining({ domainApplicationId: "da2" }));
  });

  it("locks every choice while a reuse is in flight", () => {
    renderDom(createElement(WaitlistedModal, { open: true, onClose: vi.fn(), reusing: true, options, continuedFrom: {}, onReuse: vi.fn() }));
    const buttons = Array.from(document.body.querySelectorAll("li button")) as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(getButton(document.body, "Cancel").disabled).toBe(true);
  });
});
