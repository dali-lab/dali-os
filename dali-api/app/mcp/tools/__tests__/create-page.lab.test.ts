import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("../access", () => ({ canEditProject: vi.fn() }));
vi.mock("../docs/lab-documents", () => ({ runCreateLabDocument: vi.fn() }));
vi.mock("~/collab/write", () => ({ replaceCollabDocContent: vi.fn() }));
vi.mock("~/drive/lib/page-copy.server", () => ({ duplicatePage: vi.fn() }));

import { canEditProject } from "../access";
import { runCreateLabDocument } from "../docs/lab-documents";
import { CREATE_PAGE_TOOL, runCreatePage } from "../create-page";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

beforeEach(() => vi.resetAllMocks());

describe("create_page without a projectId", () => {
  it("creates a lab page through the lab rules as the caller", async () => {
    vi.mocked(runCreateLabDocument).mockResolvedValue({ id: "lab1" });
    const out = await runCreatePage("u1", { title: "Notes", kind: "Folder", parentPageId: "f1" });
    expect(out).toEqual({ id: "lab1" });
    expect(runCreateLabDocument).toHaveBeenCalledWith("u1", { title: "Notes", kind: "Folder", parentPageId: "f1" });
    expect(canEditProject).not.toHaveBeenCalled();
  });

  it("passes on the lab gate's refusal for a non-member", async () => {
    vi.mocked(runCreateLabDocument).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(runCreatePage("u1", { title: "Notes" })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects content on a lab page instead of dropping it", async () => {
    await expect(runCreatePage("u1", { title: "Notes", content: "# Hi" })).rejects.toMatchObject({ status: 400 });
    expect(runCreateLabDocument).not.toHaveBeenCalled();
  });

  it("keeps the project gate when a projectId is given", async () => {
    vi.mocked(canEditProject).mockResolvedValue(false);
    await expect(runCreatePage("u1", { projectId: "p1", title: "Plan" })).rejects.toMatchObject({ status: 403 });
    expect(runCreateLabDocument).not.toHaveBeenCalled();
  });

  it("only needs a title", () => {
    expect(CREATE_PAGE_TOOL.inputSchema.required).toEqual(["title"]);
  });

  it("does not take kind Slides: decks are made with manage_slide_deck create", () => {
    expect(CREATE_PAGE_TOOL.inputSchema.properties.kind.enum).toEqual(["FreeForm", "Folder"]);
    expect(CREATE_PAGE_TOOL.description).not.toMatch(/slide/i);
    const result = validateInput({ title: "Deck", kind: "Slides" }, CREATE_PAGE_TOOL.inputSchema as JsonSchema);
    expect(result.ok).toBe(false);
  });
});
