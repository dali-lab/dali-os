// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, useLocation } from "react-router";

const prisma = vi.hoisted(() => ({
  term: { findMany: vi.fn() },
  staffingCycle: { findMany: vi.fn() },
  formVersion: { findFirst: vi.fn() },
  formSubmission: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  canViewStaffing: vi.fn(),
  canManageStaffing: vi.fn(),
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ pageTitle: "" }),
}));
vi.mock("~/admin/lib/eligibility.server", () => ({
  applyEligibilityWithNotify: vi.fn(),
}));
vi.mock("../../lib/staffing-cycle", () => ({ ensureStaffingCycle: vi.fn() }));
vi.mock("../../lib/intent-validation", () => ({ resyncIntentSets: vi.fn() }));
vi.mock("../../lib/form-slots", () => ({
  getSlotBinding: vi.fn(),
  isGateAudience: vi.fn(),
  listSelectableForms: vi.fn(),
  setSlotBinding: vi.fn(),
  setSlotColumnMapping: vi.fn(),
  setSlotGate: vi.fn(),
  setSlotPublished: vi.fn(),
}));
vi.mock("../../lib/submission-view.server", () => ({
  buildSubmissionView: vi.fn(),
}));
vi.mock("../../components/SlotAdvancedSettingsModal", () => ({
  SlotAdvancedSettingsModal: () => null,
}));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { ALL_TERMS } from "~/lib/terms.shared";
import { ensureStaffingCycle } from "../../lib/staffing-cycle";
import { getSlotBinding, listSelectableForms } from "../../lib/form-slots";
import { buildSubmissionView } from "../../lib/submission-view.server";
import * as intentToWork from "../projects.intent-to-work";
import * as projectBids from "../projects.project-bids";
import * as levelUp from "../projects.level-up";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FALL = { id: "t-26f", code: "26F", isCurrent: true };
const SPRING = { id: "t-26s", code: "26S", isCurrent: false };
const TERMS = [FALL, SPRING];

const BINDING = {
  formId: "form-1",
  formName: "Staffing form",
  published: true,
  publicToken: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  mapping: null,
  gateAudience: null,
  gateAudienceGroupId: null,
};
const row = (
  userId: string,
  name: string,
  domainIds: string[],
  cells: Record<string, string> = {},
) => ({
  userId,
  name,
  email: `${userId}@example.edu`,
  domainIds,
  cells,
  detailFields: [],
});

const BOARDS = [
  { name: "Intent to Work", path: "/core/intent-to-work", route: intentToWork },
  { name: "Project Bids", path: "/core/project-bids", route: projectBids },
  { name: "Level Up", path: "/core/level-up", route: levelUp },
];

let container: HTMLDivElement;
let root: Root;
let search = "";

function LocationProbe() {
  search = useLocation().search;
  return null;
}

async function mount(board: (typeof BOARDS)[number], entry: string = board.path) {
  const Stub = createRoutesStub([
    {
      path: board.path,
      loader: board.route.loader as never,
      shouldRevalidate: board.route.shouldRevalidate as never,
      Component: () =>
        createElement("div", null, createElement(board.route.default as never), createElement(LocationProbe)),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub, { initialEntries: [entry] })));
  await act(async () => {});
}

const picker = () =>
  document.querySelector<HTMLButtonElement>("button[aria-label='Filter by term']");

const advancedSettings = () =>
  Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Advanced settings"),
  );

const domainPicker = () =>
  document.querySelector<HTMLButtonElement>("button[aria-label='Filter by domain']");

const text = () => document.body.textContent ?? "";

async function pick(label: string, trigger = picker) {
  await act(async () => {
    trigger()!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const option = Array.from(
    document.querySelectorAll<HTMLElement>("[role='option']"),
  ).find((o) => o.textContent?.includes(label));
  await act(async () => {
    option!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1" },
  } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canViewStaffing).mockResolvedValue(true);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue(FALL as never);
  vi.mocked(resolveTermFilter).mockImplementation(async (request) => {
    const param = new URL(request.url).searchParams.get("term");
    const isAll = param === ALL_TERMS;
    const termId = isAll ? null : (param ?? FALL.id);
    return {
      terms: TERMS,
      selected: isAll ? ALL_TERMS : termId!,
      termId,
      termIds: termId ? [termId] : null,
      isAll,
      isUpcoming: false,
    };
  });
  vi.mocked(ensureStaffingCycle).mockImplementation(
    async (termId, termCode) =>
      ({ id: `cycle-${termId}`, name: `${termCode} Staffing` }) as never,
  );
  vi.mocked(getSlotBinding).mockResolvedValue(null as never);
  vi.mocked(listSelectableForms).mockResolvedValue([] as never);
  vi.mocked(buildSubmissionView).mockResolvedValue({
    rows: [],
    tableColumns: [],
  } as never);
  prisma.term.findMany.mockResolvedValue(TERMS);
  prisma.staffingCycle.findMany.mockResolvedValue([
    { id: "cycle-t-26f" },
    { id: "cycle-t-26s" },
  ]);
  prisma.formSubmission.findMany.mockResolvedValue([]);
  prisma.domain.findMany.mockResolvedValue([
    { id: "d-design", displayName: "Design" },
    { id: "d-eng", displayName: "Engineering" },
  ]);
  prisma.formVersion.findFirst.mockResolvedValue({ questions: [] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe.each(BOARDS)("$name term picker", (board) => {
  it("defaults to the current term", async () => {
    await mount(board);
    expect(picker()?.textContent).toContain("26F");
    expect(ensureStaffingCycle).toHaveBeenCalledWith("t-26f", "26F");
  });

  it("opens on the term named in the URL", async () => {
    await mount(board, `${board.path}?term=${SPRING.id}`);
    expect(picker()?.textContent).toContain("26S");
  });

  it("reloads the board for the term you pick", async () => {
    await mount(board);
    await pick("26S");
    expect(picker()?.textContent).toContain("26S");
    expect(ensureStaffingCycle).toHaveBeenLastCalledWith("t-26s", "26S");
    expect(vi.mocked(buildSubmissionView).mock.lastCall?.[0]).toMatchObject({
      cycleIds: ["cycle-t-26s"],
    });
  });

  it("offers All terms, which reads every cycle and hides Advanced settings", async () => {
    await mount(board);
    expect(advancedSettings()).toBeTruthy();
    await pick("All terms");
    expect(picker()?.textContent).toContain("All terms");
    expect(vi.mocked(buildSubmissionView).mock.lastCall?.[0]).toMatchObject({
      cycleIds: ["cycle-t-26f", "cycle-t-26s"],
    });
    expect(advancedSettings()).toBeUndefined();
  });
});

describe.each(BOARDS)("$name domain filter", (board) => {
  beforeEach(() => {
    vi.mocked(getSlotBinding).mockResolvedValue(BINDING as never);
    vi.mocked(buildSubmissionView).mockResolvedValue({
      rows: [row("ada", "Ada Example", ["d-design"]), row("grace", "Grace Example", ["d-eng"])],
      tableColumns: [],
    } as never);
  });

  it("lists every domain and starts on All domains", async () => {
    await mount(board);
    expect(domainPicker()?.textContent).toContain("All domains");
    expect(text()).toContain("Ada Example");
    expect(text()).toContain("Grace Example");
  });

  it("keeps only members eligible in the picked domain", async () => {
    await mount(board);
    await pick("Engineering", domainPicker);
    expect(domainPicker()?.textContent).toContain("Engineering");
    expect(text()).not.toContain("Ada Example");
    expect(text()).toContain("Grace Example");
  });

  it("filters client side without reloading the board", async () => {
    await mount(board);
    const loads = vi.mocked(buildSubmissionView).mock.calls.length;
    await pick("Design", domainPicker);
    expect(vi.mocked(buildSubmissionView).mock.calls.length).toBe(loads);
  });

  it("saves the picked domain in the URL", async () => {
    await mount(board);
    await pick("Engineering", domainPicker);
    expect(new URLSearchParams(search).get("domain")).toBe("d-eng");
  });

  it("opens on the domain in the URL", async () => {
    await mount(board, `${board.path}?domain=d-eng`);
    expect(domainPicker()?.textContent).toContain("Engineering");
    expect(text()).not.toContain("Ada Example");
    expect(text()).toContain("Grace Example");
  });
});

describe("Level Up row links", () => {
  const levelUpBoard = BOARDS.find((b) => b.name === "Level Up")!;
  const memberLink = () =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).find(
      (a) => a.textContent === "Ada Example",
    );

  beforeEach(() => {
    vi.mocked(getSlotBinding).mockResolvedValue(BINDING as never);
    vi.mocked(buildSubmissionView).mockResolvedValue({
      rows: [row("ada", "Ada Example", ["d-design"])],
      tableColumns: [],
    } as never);
  });

  it("carry the current term to the member's page", async () => {
    await mount(levelUpBoard);
    expect(memberLink()?.getAttribute("href")).toBe("/projects/level-up/ada?term=t-26f");
  });

  it("carry a picked term to the member's page", async () => {
    await mount(levelUpBoard);
    await pick("26S");
    expect(memberLink()?.getAttribute("href")).toBe("/projects/level-up/ada?term=t-26s");
  });

  it("carry All terms to the member's page", async () => {
    await mount(levelUpBoard, `${levelUpBoard.path}?term=${ALL_TERMS}`);
    expect(memberLink()?.getAttribute("href")).toBe("/projects/level-up/ada?term=all");
  });
});

describe.each(BOARDS)("$name search and column filters in the URL", (board) => {
  beforeEach(() => {
    vi.mocked(getSlotBinding).mockResolvedValue(BINDING as never);
    vi.mocked(buildSubmissionView).mockResolvedValue({
      rows: [
        row("ada", "Ada Example", ["d-design"], { status: "Yes" }),
        row("grace", "Grace Example", ["d-eng"], { status: "No" }),
      ],
      tableColumns: [{ key: "status", label: "Status" }],
    } as never);
  });

  const searchBox = () =>
    document.querySelector<HTMLInputElement>("input[aria-label='Search submissions']")!;

  async function type(value: string) {
    const input = searchBox();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("opens on the search in the URL", async () => {
    await mount(board, `${board.path}?q=grace`);
    expect(searchBox().value).toBe("grace");
    expect(text()).not.toContain("Ada Example");
    expect(text()).toContain("Grace Example");
  });

  it("filters as you type and saves the search once typing stops, without reloading", async () => {
    await mount(board);
    const loads = vi.mocked(buildSubmissionView).mock.calls.length;
    vi.useFakeTimers();
    try {
      await type("grace");
      expect(text()).not.toContain("Ada Example");
      expect(new URLSearchParams(search).get("q")).toBeNull();
      await act(async () => vi.advanceTimersByTime(300));
    } finally {
      vi.useRealTimers();
    }
    await act(async () => {});
    expect(new URLSearchParams(search).get("q")).toBe("grace");
    expect(vi.mocked(buildSubmissionView).mock.calls.length).toBe(loads);
  });

  it("opens on the column filters in the URL", async () => {
    await mount(board, `${board.path}?f.status=Yes`);
    expect(text()).toContain("Ada Example");
    expect(text()).not.toContain("Grace Example");
  });

  it("keeps search, domain and filters when the term changes", async () => {
    await mount(board, `${board.path}?q=a&domain=d-design&f.status=Yes`);
    await pick("26S");
    const params = new URLSearchParams(search);
    expect(params.get("term")).toBe("t-26s");
    expect(params.get("q")).toBe("a");
    expect(params.get("domain")).toBe("d-design");
    expect(params.getAll("f.status")).toEqual(["Yes"]);
    expect(ensureStaffingCycle).toHaveBeenLastCalledWith("t-26s", "26S");
  });
});
