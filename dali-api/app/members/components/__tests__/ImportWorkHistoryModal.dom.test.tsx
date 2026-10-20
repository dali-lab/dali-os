// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submit = vi.fn();
vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit, Form: "form" }),
  useRevalidator: () => ({ revalidate: vi.fn() }),
}));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const { ImportWorkHistoryModal } = await import("~/members/components/ImportWorkHistoryModal");

const HEADER = "Company Name,Title,Description,Location,Started On,Finished On";
const CSV = [
  HEADER,
  "Acme,Engineer,,,Jan 2020,Dec 2021",
  "Figma,Designer,,,2019,Jun 2019",
  "Initech,Analyst,,,Mar 2015,Jun 2016",
].join("\n");

const EXISTING = [
  {
    id: "w1",
    company: "Initech, Inc.",
    position: "Analyst",
    description: null,
    location: null,
    workMode: null,
    startMonth: "2015-03",
    endMonth: "2016-06",
  },
];

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(ImportWorkHistoryModal, { memberId: "u1", existing: EXISTING, onClose: vi.fn() }));
  });
}

async function pickFile(name: string, content: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([content], name);
  if (typeof file.text !== "function") Object.defineProperty(file, "text", { value: async () => content });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const settled = () => !document.querySelector('input[type="file"]') || document.querySelector('[role="alert"]');
  for (let i = 0; i < 100 && !settled(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const checkbox = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const addButton = () => [...document.querySelectorAll("button")].find((b) => /^Add \d+ jobs?$/.test(b.textContent ?? ""))!;

beforeEach(() => {
  submit.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ImportWorkHistoryModal", () => {
  it("turns a Positions.csv into a review list", async () => {
    await mount();
    await pickFile("Positions.csv", CSV);
    expect(document.body.textContent).toContain("Engineer");
    expect(document.body.textContent).toContain("Figma");
    expect(document.body.textContent).toContain("Jan 2020 to Dec 2021");
  });

  it("blocks a row with no start month until it is fixed", async () => {
    await mount();
    await pickFile("Positions.csv", CSV);
    expect(checkbox("Designer at Figma").disabled).toBe(true);
    expect(checkbox("Designer at Figma").checked).toBe(false);
    expect(document.body.textContent).toContain("Pick a start month");
  });

  it("starts a duplicate unchecked and labels it", async () => {
    await mount();
    await pickFile("Positions.csv", CSV);
    expect(checkbox("Analyst at Initech").checked).toBe(false);
    expect(checkbox("Analyst at Initech").disabled).toBe(false);
    expect(document.body.textContent).toContain("Already on your profile");
  });

  it("counts only the checked rows on the Add button", async () => {
    await mount();
    await pickFile("Positions.csv", CSV);
    expect(addButton().textContent).toBe("Add 1 job");

    await act(async () => checkbox("Analyst at Initech").click());
    expect(addButton().textContent).toBe("Add 2 jobs");

    await act(async () => checkbox("Engineer at Acme").click());
    expect(addButton().textContent).toBe("Add 1 job");
  });

  it("submits only the checked rows as import-experiences", async () => {
    await mount();
    await pickFile("Positions.csv", CSV);
    await act(async () => addButton().click());

    const [payload, options] = submit.mock.calls[0];
    expect(payload.intent).toBe("import-experiences");
    expect(JSON.parse(payload.jobs)).toEqual([
      expect.objectContaining({ company: "Acme", position: "Engineer", startMonth: "2020-01", endMonth: "2021-12" }),
    ]);
    expect(options).toEqual({ method: "post" });
  });

  it("tells the member to unzip a .zip", async () => {
    await mount();
    await pickFile("Basic_LinkedInDataExport.zip", "PK");
    expect(document.body.textContent).toContain("Unzip it first and upload Positions.csv.");
  });

  it("rejects a CSV that is not Positions.csv", async () => {
    await mount();
    await pickFile("Connections.csv", "First Name,Last Name\nA,B\n");
    expect(document.body.textContent).toContain("This doesn't look like LinkedIn's Positions.csv.");
  });

  it("says so when the file has no jobs", async () => {
    await mount();
    await pickFile("Positions.csv", `${HEADER}\n`);
    expect(document.body.textContent).toContain("We couldn't find any jobs in this file.");
  });

  describe("PDF upload", () => {
    const respond = (body: unknown, ok = true) =>
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => body }));

    afterEach(() => vi.unstubAllGlobals());

    it("posts the file with extract=1 and shows the jobs it finds", async () => {
      const job = { key: "job-0", company: "Acme", position: "Engineer", description: null, location: null, workMode: null, startMonth: "2020-01", startYear: 2020, endMonth: "", endYear: null, current: true };
      respond({ resume: { fileName: "cv.pdf", uploadedAt: "2026-10-20T00:00:00Z" }, jobs: [job] });
      await mount();
      await pickFile("cv.pdf", "%PDF-1.7");

      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("/api/members/u1/resume");
      expect((init!.body as FormData).get("extract")).toBe("1");
      expect(document.body.textContent).toContain("Engineer");
    });

    it.each([
      ["quota", "You've used today's AI limit. Your resume is saved; add jobs by hand or try again tomorrow."],
      ["rate", "Too many imports in a row. Your resume is saved; try again in a few minutes."],
      ["failed", "Saved as your resume. We couldn't read the jobs from it."],
    ])("shows the %s message and keeps the resume", async (extractError, copy) => {
      respond({ resume: { fileName: "cv.pdf", uploadedAt: "2026-10-20T00:00:00Z" }, extractError });
      await mount();
      await pickFile("cv.pdf", "%PDF-1.7");
      expect(document.body.textContent).toContain(copy);
    });

    it("shows the server's message when the upload is refused", async () => {
      respond({ error: "Upload a PDF." }, false);
      await mount();
      await pickFile("cv.pdf", "not a pdf");
      expect(document.body.textContent).toContain("Upload a PDF.");
    });
  });
});
