// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const { confirm, toastError } = vi.hoisted(() => ({ confirm: vi.fn(), toastError: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }) }));
vi.mock("~/hiring/components/ConfidentialityGate", () => ({ ConfidentialityGate: () => <div data-testid="gate" /> }));

import { act } from "react";
import { renderDom, getButton } from "~/test-utils/render";
import { DecisionsTab, DecisionList, usePendingDecisions, type DecisionListContext } from "../DecisionsTab";
import type { PendingDecision } from "~/hiring/lib/lead-cycle-types";

const decision = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    stage: "Final",
    type: "Accepted",
    interviewRoundId: null,
    openSiblingDomains: [],
    domainApplication: { domain: { name: "Design" }, application: { user: { firstName: "Ada", lastName: "Lovelace" }, startTerm: null } },
    madeBy: { firstName: "Grace", lastName: "Hopper" },
    ...over,
  }) as unknown as PendingDecision;

const ctx = (over: Partial<DecisionListContext> = {}): DecisionListContext => ({
  cycleId: "c1",
  tab: "decisions",
  confidentialityRequired: null,
  hiringEmails: { "decision:Accepted": { subject: "s", body: "b" } },
  termOptions: [],
  termId: null,
  offerRespondBy: null,
  waitlistRespondBy: null,
  activeRoundInterviewRoundId: null,
  slotFor: (d) => `decision:${d.type}` as never,
  ...over,
});

function Lists({ initial, kind, context }: { initial: PendingDecision[]; kind: "invites" | "finalize" | "outcomes"; context: DecisionListContext }) {
  const decisions = usePendingDecisions(initial);
  return <DecisionList kind={kind} decisions={decisions} ctx={context} />;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("DecisionList", () => {
  it("shows only finals on the outcomes list and drafts on the finalize list", () => {
    const initial = [decision("f1"), decision("d1", { stage: "Draft" })];
    const outcomes = renderDom(<Lists initial={initial} kind="outcomes" context={ctx()} />);
    expect(outcomes.container.textContent).toContain("1 waiting.");
    expect(outcomes.container.textContent).toContain("Release all (1)");
    outcomes.unmount();
    const finalize = renderDom(<Lists initial={initial} kind="finalize" context={ctx()} />);
    expect(finalize.container.textContent).toContain("Finalize all (1)");
  });

  it("shows the empty copy when nothing is waiting", () => {
    const { container } = renderDom(<Lists initial={[]} kind="finalize" context={ctx()} />);
    expect(container.textContent).toContain("No drafts to finalize.");
  });

  it("shows the confidentiality gate instead of the list", () => {
    const { container } = renderDom(<Lists initial={[decision("f1")]} kind="outcomes" context={ctx({ confidentialityRequired: "unsigned" })} />);
    expect(container.querySelector('[data-testid="gate"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Ada Lovelace");
  });

  it("disables release for a decision whose email is not written", () => {
    const { container } = renderDom(<Lists initial={[decision("f1")]} kind="outcomes" context={ctx({ hiringEmails: {} })} />);
    expect(getButton(container, "Release").disabled).toBe(true);
  });

  it("releases one decision after confirming and removes it from the list", async () => {
    confirm.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: true });
    const { container } = renderDom(<Lists initial={[decision("f1")]} kind="outcomes" context={ctx()} />);
    await act(async () => getButton(container, "Release").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/hiring/decisions/f1/release", { method: "POST", credentials: "include" });
    expect(container.textContent).not.toContain("Ada Lovelace");
  });

  it("uses the stronger warning when an acceptance would close an open sibling application", async () => {
    confirm.mockResolvedValue(false);
    const d = decision("f1", { openSiblingDomains: [{ name: "Web", closeDate: null }] });
    const { container } = renderDom(<Lists initial={[d]} kind="outcomes" context={ctx()} />);
    await act(async () => getButton(container, "Release").click());
    expect(confirm.mock.calls[0][0]).toMatchObject({ title: "Accept and close Web?", confirmLabel: "Accept and close" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finalizes a draft and moves it to the final stage", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: "f9" }) });
    const { container } = renderDom(<Lists initial={[decision("d1", { stage: "Draft" })]} kind="finalize" context={ctx()} />);
    await act(async () => getButton(container, "Finalize").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/hiring/decisions/d1/finalize", { method: "POST", credentials: "include" });
    expect(container.textContent).not.toContain("1 waiting.");
  });

  it("toasts the server error when finalizing fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ error: "Already finalized" }) });
    const { container } = renderDom(<Lists initial={[decision("d1", { stage: "Draft" })]} kind="finalize" context={ctx()} />);
    await act(async () => getButton(container, "Finalize").click());
    expect(toastError).toHaveBeenCalledWith("Already finalized");
    expect(container.textContent).toContain("1 waiting.");
  });

  it("limits the invites list to the round it feeds", () => {
    const initial = [
      decision("i1", { type: "InvitedToInterview", interviewRoundId: "interview-2" }),
      decision("i2", { type: "InvitedToInterview", interviewRoundId: null }),
    ];
    const { container } = renderDom(<Lists initial={initial} kind="invites" context={ctx({ activeRoundInterviewRoundId: "interview-2" })} />);
    expect(container.textContent).toContain("1 waiting.");
  });
});

describe("DecisionsTab", () => {
  function Tab({ cycleStatus, showFinalize }: { cycleStatus: string; showFinalize: boolean }) {
    const decisions = usePendingDecisions([decision("f1"), decision("d1", { stage: "Draft" })]);
    return <DecisionsTab cycleStatus={cycleStatus} showFinalize={showFinalize} decisions={decisions} ctx={ctx()} onComplete={vi.fn()} />;
  }

  it("shows drafts, releases and the complete card for an under review cycle", () => {
    const { container } = renderDom(<Tab cycleStatus="UnderReview" showFinalize />);
    expect(container.querySelector("#finalize")).not.toBeNull();
    expect(container.querySelector("#release")).not.toBeNull();
    expect(container.textContent).toContain("Complete the cycle");
  });

  it("hides the complete card unless the cycle is under review", () => {
    const { container } = renderDom(<Tab cycleStatus="Open" showFinalize={false} />);
    expect(container.querySelector("#finalize")).toBeNull();
    expect(container.textContent).not.toContain("Complete the cycle");
  });
});
