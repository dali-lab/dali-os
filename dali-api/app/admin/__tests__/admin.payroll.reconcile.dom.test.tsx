// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/admin/lib/payroll-reconcile.server", () => ({ getReconciliation: vi.fn() }));
vi.mock("~/lib/chart-string.server", () => ({
  resolveChartStringsForTerm: vi.fn(),
  recordProjectChartString: vi.fn(),
  ChartStringValidationError: class extends Error {},
}));
vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return { BarChart: Pass, Bar: Pass, XAxis: Pass, YAxis: Pass, Tooltip: Pass, ResponsiveContainer: Pass, CartesianGrid: Pass };
});

import PayrollReconcile from "~/admin/routes/admin.payroll";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const job = (over: Record<string, unknown> = {}) => ({
  netId: "f00pay01",
  name: "Ada Lovelace",
  jobId: "4834",
  jobTitle: "DALI Lab Student Employee",
  category: "Project",
  hours: 3,
  pay: 48.75,
  sharedWith: [],
  ...over,
});

const REC = {
  projects: [
    { projectId: "p-os", projectName: "DALI OS", totalHours: 3, sharedHours: 0, totalPay: 48.75, jobs: [job()] },
    { projectId: "p-lapsed", projectName: "zebraMD", totalHours: 2, sharedHours: 0, totalPay: 30, jobs: [job({ netId: "f00pay02", name: "Grace Hopper", hours: 2, pay: 30 })] },
  ],
  core: { category: "Core", totalHours: 0, totalPay: 0, jobs: [] },
  instructor: { category: "Instructor", totalHours: 0, totalPay: 0, jobs: [] },
  external: { category: "External", totalHours: 5, totalPay: 80, jobs: [job({ netId: "x001", name: "Ext Person", jobId: "9999", hours: 5, pay: 80 })] },
  chartStrings: [
    {
      chartString: "18.722.161028.128512.4000",
      totalHours: 3,
      totalPay: 48.75,
      projects: [{ id: "p-os", name: "DALI OS" }],
      ambiguousProject: true,
      students: [{ netId: "f00pay01", name: "Ada Lovelace", hours: 3, pay: 48.75 }],
    },
  ],
  discrepancies: {
    assignedNoHours: [{ type: "assigned_no_hours", netId: "f00pay03", name: "Alan Turing", projectId: "p-os", projectName: "DALI OS" }],
    unassignedJobs: [],
    rateMismatches: [],
    unknownPersons: [{ type: "unknown_person", netId: "zz999", name: "Nobody", hours: 1, pay: 16 }],
  },
  summary: {
    daliHours: 5, daliPay: 78.75, externalHours: 5, externalPay: 80, totalHours: 10, totalPay: 158.75,
    daliStudentCount: 2, medianPay: 39.38,
  },
  notesByJobKey: {
    "f00pay01::4834": [{ note: "Worked the demo day", validatedChartstring: null, linkToTimesheet: null, payPeriodName: "PP-1" }],
  },
};

const LOADER_DATA = {
  terms: [{ id: "term-26s", code: "26S" }],
  selected: "term-26s",
  termId: "term-26s",
  isAll: false,
  reconciliation: REC,
  periods: [{ id: "pp1", name: "PP-1", termCode: "26S", entries: 12, importedBy: "Admin User", importedAt: "2026-10-01T12:00:00.000Z" }],
  missingChartStrings: [{ projectId: "p-lapsed", name: "zebraMD", lastOwnTermCode: "26W" }],
  projectChartStrings: {
    "p-os": { chartString: "18.722.161028.128512.4000", source: "project" },
    "p-lapsed": { chartString: "20.330.161028.128512.4000", source: "builtIn" },
  },
  isAdmin: true,
};

let container: HTMLDivElement;
let root: Root;
const actionSpy = vi.fn();

async function mount(data: unknown = LOADER_DATA) {
  const Stub = createRoutesStub([
    {
      path: "/admin/payroll/reconcile",
      loader: () => data,
      action: async ({ request }) => {
        const form = Object.fromEntries(await request.formData());
        actionSpy(form);
        return { ok: true, projectId: form.projectId, chartString: "18.722.161028.128512.3000", warnings: [] };
      },
      Component: PayrollReconcile as never,
    },
    { path: "/admin/payroll/budget", loader: () => ({ ok: true, termId: "term-26s", budget: { groups: [] } }) },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub, { initialEntries: ["/admin/payroll/reconcile"] })));
  await act(async () => {});
}

const text = () => document.body.textContent ?? "";
const tab = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((b) => b.textContent?.startsWith(name))!;
async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
  await act(async () => {});
}

beforeEach(() => {
  actionSpy.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Payroll reconcile page", () => {
  it("shows the figures, the CSV total and the latest import", async () => {
    await mount();
    expect(text()).toContain("DALI hours");
    expect(text()).toContain("Students paid");
    expect(text()).toContain("= CSV total $158.75");
    expect(text()).toContain("1 pay period · 12 entries · Last import by Admin User");
  });

  it("has all seven views, with the discrepancy count and external hours as badges", async () => {
    await mount();
    const tabs = Array.from(document.querySelectorAll("[role='tab']")).map((t) => t.textContent);
    expect(tabs).toEqual([
      "Summary", "Payroll Data", "Project Summaries", "Chart Strings", "Discrepancies2", "External5 hrs", "Budget",
    ]);
    expect(tab("Summary").getAttribute("aria-selected")).toBe("true");
    expect(text()).toContain("Pay periods");
    expect(text()).toContain("Hours by project");
  });

  it("export links to the CSV for the current view", async () => {
    await mount();
    const link = () => document.querySelector<HTMLAnchorElement>("a[aria-label='Export CSV']")!;
    expect(link().getAttribute("href")).toBe("/admin/payroll.csv?view=summary&term=term-26s");
    await click(tab("Chart Strings"));
    expect(link().getAttribute("href")).toBe("/admin/payroll.csv?view=chart-strings&term=term-26s");
  });

  it("payroll data searches, sorts and opens notes", async () => {
    await mount();
    await click(tab("Payroll Data"));
    const names = () => Array.from(document.querySelectorAll("tbody tr td:first-child")).map((td) => td.textContent);
    expect(names()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    await click(Array.from(document.querySelectorAll("th button")).find((b) => b.textContent?.startsWith("Student"))!);
    expect(names()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    await click(document.querySelector("[aria-label='View notes for Ada Lovelace']")!);
    expect(text()).toContain("Worked the demo day");
  });

  it("project summaries show chart strings, the grand total and inline entry for missing ones", async () => {
    await mount();
    await click(tab("Project Summaries"));
    expect(text()).toContain("Grand total (DALI projects)");
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    expect(rows[0]!.textContent).toContain("18.722.161028.128512.4000");
    expect(rows[1]!.textContent).toContain("Missing · Add");
  });

  it("chart strings expand to the per-student breakdown and flag ambiguity", async () => {
    await mount();
    await click(tab("Chart Strings"));
    expect(text()).toContain("Ambiguous");
    expect(text()).not.toContain("f00pay01");
    await click(document.querySelector("[aria-label='Expand']")!);
    expect(text()).toContain("f00pay01");
  });

  it("discrepancies show only the non-empty groups", async () => {
    await mount();
    await click(tab("Discrepancies"));
    expect(text()).toContain("Assigned, but no hours");
    expect(text()).toContain("Unknown person");
    expect(text()).toContain("Not in DALI OS, still counted");
    expect(text()).not.toContain("Rate mismatch");
  });

  it("external is collapsed until opened", async () => {
    await mount();
    await click(tab("External"));
    expect(text()).not.toContain("Ext Person");
    const toggle = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.startsWith("External, not DALI"))!;
    expect(toggle.textContent).toContain("1 people · 5 hrs · $80.00");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain("Ext Person");
  });

  it("warns about missing chart strings without blocking export, and saves one inline", async () => {
    await mount();
    const alert = document.querySelector("[role='alert']")!;
    expect(alert.textContent).toContain("1 staffed project with no chart string this term");
    expect(alert.textContent).toContain("Export still works");
    expect(document.querySelector("a[aria-label='Export CSV']")).not.toBeNull();

    await click(Array.from(alert.querySelectorAll("button")).find((b) => b.textContent?.includes("Missing · Add"))!);
    const input = document.querySelector<HTMLInputElement>("input[aria-label='Chart string for zebraMD']")!;
    input.value = "18.722.161028.128512.3000";
    await act(async () => input.form!.requestSubmit());
    await act(async () => {});
    expect(actionSpy).toHaveBeenCalledWith({
      intent: "set-chart-string",
      projectId: "p-lapsed",
      termId: "term-26s",
      chartString: "18.722.161028.128512.3000",
    });
    expect(document.querySelector("[role='alert']")!.textContent).toContain("Saved");
  });

  it("the warning can be dismissed", async () => {
    await mount();
    await click(document.querySelector("[aria-label='Dismiss chart string warning']")!);
    expect(document.querySelector("[role='alert']")).toBeNull();
  });

  it("shows the empty state with an upload button when there is no timesheet data", async () => {
    await mount({
      ...LOADER_DATA,
      reconciliation: { ...REC, summary: { ...REC.summary, totalHours: 0, totalPay: 0 } },
      missingChartStrings: [],
    });
    expect(text()).toContain("No timesheet data for this term yet");
    expect(document.querySelector("[role='tablist']")).toBeNull();
    expect(document.querySelector("a[aria-label='Export CSV']")).toBeNull();
    const upload = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Upload CSV"))!;
    await click(upload);
    expect(text()).toContain("Import TimesheetX export");
    expect(document.querySelector("input[name='timesheet']")).not.toBeNull();
    expect(document.querySelector("input[name='notes']")).not.toBeNull();
  });
});
