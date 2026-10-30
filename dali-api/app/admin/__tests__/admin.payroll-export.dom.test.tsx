// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn(), currentTermMemberWhere: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/admin/lib/payroll-export", () => ({
  buildPayrollRows: vi.fn(),
  listCoreCandidates: vi.fn(),
  listInstructorCandidates: vi.fn(),
  listTechnigalaCandidates: vi.fn(),
  listTermDomains: vi.fn(),
  pickDefaultTermId: vi.fn(),
}));

import PayrollExport from "~/admin/routes/admin.payroll-export";
import { DialogProvider } from "~/components/ui/dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projectRow = (over: Record<string, unknown> = {}) => ({
  netId: "f001",
  firstName: "Ada",
  lastName: "Lovelace",
  jobId: "4834",
  hourlyWage: "16.25",
  hireStart: "091826",
  hireEnd: "121726",
  chartStringType: "GL",
  chartString: "18.722.161028.128512.4000",
  domain: "Engineering",
  level: "P1",
  warnings: [] as string[],
  ...over,
});

const DATA = {
  terms: [
    { id: "t-26s", code: "26S", isCurrent: true },
    { id: "t-26w", code: "26W", isCurrent: false },
  ],
  selectedTermId: "t-26s",
  selectedTermCode: "26S",
  projectRows: [
    projectRow(),
    projectRow({ netId: "", firstName: "Grace", lastName: "Hopper", warnings: ["User missing NetID"] }),
  ],
  coreCandidates: [{ userId: "u-core", netId: "f002", firstName: "Alan", lastName: "Turing", subtitle: "Staffing Lead" }],
  instructorCandidates: [{ userId: "u-ins", netId: "f003", firstName: "Katherine", lastName: "Johnson", subtitle: "Intro to React" }],
  technigalaCandidates: [{ userId: "u-tech", netId: "f004", firstName: "Hedy", lastName: "Lamarr", subtitle: "Technigala" }],
  addableMembers: [
    { id: "u-tech", name: "Hedy Lamarr", netId: "f004" },
    { id: "u-new", name: "Mary Jackson", netId: "f005" },
  ],
  termDomains: [{ id: "d-eng", displayName: "Engineering" }],
  selectedDomainIds: [] as string[],
  selectedLevels: [] as string[],
  isAdmin: true,
};

let container: HTMLDivElement;
let root: Root;
const actionSpy = vi.fn();

async function mount(data: unknown = DATA) {
  const Stub = createRoutesStub([
    {
      path: "/admin/payroll/hire-setup",
      loader: () => data,
      action: async ({ request }) => {
        actionSpy(Object.fromEntries(await request.formData()));
        return { ok: true };
      },
      Component: PayrollExport as never,
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/admin/payroll/hire-setup"] }))),
  );
  await act(async () => {});
}

const text = () => document.body.textContent ?? "";
const csvHref = () =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).find((a) => a.textContent?.includes("Export CSV"))!.getAttribute("href")!;
const radio = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("[role='radio']")).find((b) => b.textContent?.startsWith(label))!;
const rowNames = () =>
  Array.from(document.querySelectorAll("tbody tr")).map((tr) => tr.querySelector("td:nth-child(2) p")?.textContent);
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

describe("Payroll hire setup page", () => {
  it("summarizes the export and lists every hire in one table", async () => {
    await mount();
    expect(text()).toContain("5 rows in the export: 2 project, 1 Core, 1 Instructors, 1 Technigala.");
    expect(rowNames()).toEqual(["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Hedy Lamarr"]);
    expect(text()).not.toMatch(/hrs\s*\/\s*wk|\/ week/i);
  });

  it("role filter shows counts and narrows the table", async () => {
    await mount();
    const labels = Array.from(document.querySelectorAll("[role='radio']")).map((r) => r.textContent);
    expect(labels).toEqual(["All5", "Projects2", "Core1", "Instructors1", "Technigala1"]);
    await click(radio("Core"));
    expect(rowNames()).toEqual(["Alan Turing"]);
    await click(radio("Projects"));
    expect(rowNames()).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("flags rows with missing data in a warning and a status pill, without blocking export", async () => {
    await mount();
    expect(document.querySelector("[role='alert']")!.textContent).toContain(
      "1 row with missing data. Export still works",
    );
    expect(document.querySelector("[role='alert']")!.textContent).toContain("Grace Hopper (User missing NetID)");
    expect(text()).toContain("Ready");
  });

  it("the CSV link carries the term and every included opt-in person", async () => {
    await mount();
    const params = new URL(csvHref(), "http://x").searchParams;
    expect(params.get("term")).toBe("t-26s");
    expect(params.get("core")).toBe("u-core");
    expect(params.get("instructor")).toBe("u-ins");
    expect(params.get("technigala")).toBe("u-tech");
  });

  it("unchecking a person drops them from the CSV and marks them skipped", async () => {
    await mount();
    await click(document.querySelector("input[aria-label='Include Alan Turing in payroll export']")!);
    expect(new URL(csvHref(), "http://x").searchParams.get("core")).toBeNull();
    expect(text()).toContain("Skipped");
    expect(text()).toContain("4 rows in the export");
  });

  it("select all and clear all work per opt-in role", async () => {
    await mount();
    await click(radio("Instructors"));
    expect(text()).toContain("1 of 1 included");
    await click(Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Clear all")!);
    expect(text()).toContain("0 of 1 included");
    expect(new URL(csvHref(), "http://x").searchParams.get("instructor")).toBeNull();
    await click(Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Select all")!);
    expect(new URL(csvHref(), "http://x").searchParams.get("instructor")).toBe("u-ins");
  });

  it("removing a Technigala hire confirms, then posts remove-technigala", async () => {
    await mount();
    await click(document.querySelector("[aria-label='Remove Hedy Lamarr from Technigala']")!);
    expect(text()).toContain("Remove Hedy Lamarr from Technigala?");
    const confirm = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === "Remove").pop()!;
    await click(confirm);
    expect(actionSpy).toHaveBeenCalledWith({ intent: "remove-technigala", userId: "u-tech", termId: "t-26s" });
  });

  it("the Technigala picker lists only members not already hired and posts add-technigala", async () => {
    await mount();
    await click(document.querySelector("button[aria-label='Add a Technigala hire']")!);
    const options = Array.from(document.querySelectorAll("ul li button")).map((b) => b.textContent);
    expect(options).toEqual(["Mary Jackson · f005"]);
    await click(Array.from(document.querySelectorAll("ul li button")).find((b) => b.textContent === "Mary Jackson · f005")!);
    expect(actionSpy).toHaveBeenCalledWith({ intent: "add-technigala", userId: "u-new", termId: "t-26s" });
  });

  it("domain and level filters show for project rows, with clear and a summary", async () => {
    await mount({ ...DATA, selectedDomainIds: ["d-eng"], selectedLevels: ["P1"] });
    expect(text()).toContain("Clear filter");
    expect(text()).toContain("Project assignments narrowed to Engineering · P1");
    await click(radio("Core"));
    expect(text()).not.toContain("Clear filter");
  });

  it("says so when there are no terms", async () => {
    await mount({ ...DATA, terms: [], selectedTermId: null, projectRows: [], coreCandidates: [], instructorCandidates: [], technigalaCandidates: [] });
    expect(text()).toContain("No terms found");
  });
});
