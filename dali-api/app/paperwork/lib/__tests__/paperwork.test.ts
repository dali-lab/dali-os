import { describe, expect, it } from "vitest";
import {
  buildPaperwork,
  graduatingClassYear,
  isDartmouthAddress,
  shortDate,
  termLabel,
  type PaperworkInput,
} from "../paperwork";

const base = (over: Partial<PaperworkInput> = {}): PaperworkInput => ({
  termLabel: "Fall 2026",
  returnedExpenses: [],
  unpaidExpenseCount: 0,
  expensesEnabled: true,
  fileableCards: [],
  outstandingSignatures: [],
  signedCount: 0,
  staffingForms: [],
  classCount: null,
  applications: [],
  referEnabled: true,
  referralCount: 0,
  feedbackEnabled: true,
  certificateCount: 0,
  wallet: null,
  graduationEmail: null,
  onboarding: null,
  desktop: { done: true },
  ...over,
});

describe("waiting on you", () => {
  it("lists sent-back expenses with the reviewer's note and a link to the expense", () => {
    const { waiting } = buildPaperwork(
      base({ returnedExpenses: [{ id: "e1", merchant: "Gnomon", totalCents: 4000, decisionNote: "It needs an itemized receipt." }] }),
    );
    expect(waiting).toEqual([
      {
        id: "expense-e1",
        kind: "expense",
        title: "Gnomon · $40.00",
        detail: "Sent back. It needs an itemized receipt.",
        action: { label: "Open expense", href: "/expenses?expense=e1" },
      },
    ]);
  });

  it("falls back when a sent-back expense has no merchant, total or note", () => {
    const [item] = buildPaperwork(base({ returnedExpenses: [{ id: "e2", merchant: null, totalCents: null, decisionNote: null }] })).waiting;
    expect(item.title).toBe("Expense");
    expect(item.detail).toBe("Sent back for changes.");
  });

  it("lists documents to sign after expenses, each linking to its signing page", () => {
    const { waiting } = buildPaperwork(
      base({
        returnedExpenses: [{ id: "e1", merchant: "Gnomon", totalCents: 100, decisionNote: null }],
        outstandingSignatures: [{ bindingId: "b1", documentName: "Winter term agreement" }],
      }),
    );
    expect(waiting.map((w) => w.id)).toEqual(["expense-e1", "sign-b1"]);
    expect(waiting[1].action).toEqual({ label: "Review and sign", href: "/sign/b1" });
  });

  it("is empty when nothing needs the member", () => {
    expect(buildPaperwork(base()).waiting).toEqual([]);
  });
});

describe("this term", () => {
  it("marks unsent staffing forms to do and sent ones done with the date", () => {
    const { term } = buildPaperwork(
      base({
        staffingForms: [
          { slot: "intent-to-work", formName: "Intent to work", fillLink: "/forms/fill/t1", submitted: true, submittedAt: "2026-11-04T15:00:00Z" },
          { slot: "project-bids", formName: "Project bids", fillLink: "/forms/fill/t2", submitted: false, submittedAt: null },
        ],
      }),
    );
    expect(term).toEqual([
      { id: "form-intent-to-work", kind: "form", title: "Intent to work", detail: "Sent Nov 4", status: "done", action: { label: "View", href: "/forms/fill/t1" } },
      { id: "form-project-bids", kind: "form", title: "Project bids", detail: "Not sent yet", status: "todo", action: { label: "Open form", href: "/forms/fill/t2" } },
    ]);
  });

  it("asks for classes when none are added and links to the classes settings", () => {
    const [row] = buildPaperwork(base({ classCount: 0 })).term;
    expect(row).toMatchObject({ title: "Classes", detail: "None added yet", status: "todo" });
    expect(row.action).toEqual({ label: "Add classes", href: "/calendar?settings=classes" });
  });

  it("counts added classes", () => {
    expect(buildPaperwork(base({ classCount: 1 })).term[0]).toMatchObject({ detail: "1 class added", status: "done" });
    expect(buildPaperwork(base({ classCount: 3 })).term[0]).toMatchObject({ detail: "3 classes added", action: { label: "Edit" } });
  });

  it("leaves classes out when there's no term to add them to", () => {
    expect(buildPaperwork(base({ classCount: null })).term).toEqual([]);
  });

  it("lists open applications with their due date", () => {
    const [row] = buildPaperwork(
      base({ applications: [{ id: "c1", title: "Apply to Core", body: "Core 27W", link: "/core/apply/c1", dueAt: "2027-01-05T05:00:00Z" }] }),
    ).term;
    expect(row).toEqual({
      id: "apply-c1",
      kind: "application",
      title: "Apply to Core",
      detail: "Due Jan 5",
      status: "open",
      action: { label: "Apply", href: "/core/apply/c1" },
    });
  });

  it("shows the cycle name for an application with no deadline and drops one with no link", () => {
    const { term } = buildPaperwork(
      base({
        applications: [
          { id: "c1", title: "Apply to the fellowship", body: "Fellows 27W", link: "/fellowship/c1", dueAt: null },
          { id: "c2", title: "Apply to Core", body: null, link: null, dueAt: null },
        ],
      }),
    );
    expect(term.map((r) => [r.id, r.detail])).toEqual([["apply-c1", "Fellows 27W"]]);
  });
});

describe("anytime", () => {
  it("shows expenses, referrals and feedback with their resting copy", () => {
    expect(buildPaperwork(base()).anytime).toEqual([
      { id: "expense", title: "File an expense", detail: "Receipts for lab purchases", href: "/expenses" },
      { id: "refer", title: "Refer a partner", detail: "Leads for new partner projects", href: "/refer" },
      { id: "feedback", title: "Send feedback", detail: "Bugs and suggestions for DALI OS", href: "/feedback" },
    ]);
  });

  it("swaps in counts once there's history", () => {
    const tiles = buildPaperwork(base({ unpaidExpenseCount: 2, referralCount: 1, certificateCount: 2, signedCount: 6 })).anytime;
    expect(tiles.map((t) => [t.id, t.detail])).toEqual([
      ["expense", "2 not paid back yet"],
      ["refer", "1 sent"],
      ["feedback", "Bugs and suggestions for DALI OS"],
      ["certificates", "2 earned"],
      ["signed", "6 signed"],
    ]);
  });

  it("lists the staff cards a member can file on, right after expenses", () => {
    const tiles = buildPaperwork(base({ fileableCards: [{ nickname: "Design", last4: "4242" }, { nickname: "Events", last4: "1111" }] })).anytime;
    expect(tiles[1]).toEqual({ id: "cards", title: "Staff cards you can use", detail: "Design ··4242, Events ··1111", href: "/expenses" });
  });

  it("hides expense tiles, staff cards included, while expenses are off", () => {
    const tiles = buildPaperwork(base({ expensesEnabled: false, fileableCards: [{ nickname: "Design", last4: "4242" }] })).anytime;
    expect(tiles.map((t) => t.id)).toEqual(["refer", "feedback"]);
  });

  it("hides referrals and feedback when the member can't use them", () => {
    expect(buildPaperwork(base({ referEnabled: false, feedbackEnabled: false })).anytime.map((t) => t.id)).toEqual(["expense"]);
  });
});

describe("set up once", () => {
  it("lists what's left first, then what's done", () => {
    const { setup } = buildPaperwork(
      base({ wallet: { done: false }, graduationEmail: { done: false }, onboarding: { done: true }, desktop: { done: true } }),
    );
    expect(setup.map((s) => [s.id, s.done])).toEqual([
      ["wallet", false],
      ["graduation-email", false],
      ["onboarding", true],
      ["desktop", true],
    ]);
    expect(setup[1].action).toEqual({ label: "Add", href: "/settings/security#contact-email" });
  });

  it("disappears once everything is done", () => {
    expect(buildPaperwork(base({ wallet: { done: true }, onboarding: { done: true }, desktop: { done: true } })).setup).toEqual([]);
  });

  it("only shows the items that apply to the member", () => {
    expect(buildPaperwork(base({ desktop: { done: false } })).setup.map((s) => s.id)).toEqual(["desktop"]);
  });
});

describe("helpers", () => {
  it("formats dates in UTC", () => {
    expect(shortDate("2026-12-01T03:00:00Z")).toBe("Dec 1");
  });

  it("names the term", () => {
    expect(termLabel({ season: "F", year: 2026 })).toBe("Fall 2026");
    expect(termLabel(null)).toBeNull();
  });

  it("rolls the graduating class over in July", () => {
    expect(graduatingClassYear(new Date("2026-06-30T12:00:00Z"))).toBe(2026);
    expect(graduatingClassYear(new Date("2026-07-01T12:00:00Z"))).toBe(2027);
  });

  it("recognizes Dartmouth addresses, alumni ones included", () => {
    expect(isDartmouthAddress("ada.lovelace.27@dartmouth.edu")).toBe(true);
    expect(isDartmouthAddress("ada@alum.dartmouth.edu")).toBe(true);
    expect(isDartmouthAddress("ada@example.com")).toBe(false);
    expect(isDartmouthAddress(null)).toBe(false);
  });
});
