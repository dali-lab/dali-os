import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("../get-project-overview", () => ({ runGetProjectOverview: vi.fn() }));
vi.mock("../project-settings", () => ({ runGetProjectSettings: vi.fn() }));
vi.mock("../project-showcase", () => ({ runGetProjectShowcase: vi.fn() }));

import { GET_PROJECT_TOOL, runGetProject } from "../get-project";
import { runGetProjectOverview } from "../get-project-overview";
import { runGetProjectSettings } from "../project-settings";
import { runGetProjectShowcase } from "../project-showcase";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runGetProjectOverview).mockResolvedValue({ id: "p1", from: "overview" } as never);
  vi.mocked(runGetProjectSettings).mockResolvedValue({ id: "p1", from: "settings" } as never);
  vi.mocked(runGetProjectShowcase).mockResolvedValue({ projectId: "p1", from: "showcase" } as never);
});

describe("get_project", () => {
  it("is a read tool that needs only a projectId", () => {
    expect(GET_PROJECT_TOOL.requiredScope).toBe("mcp:read");
    expect(GET_PROJECT_TOOL.inputSchema.required).toEqual(["projectId"]);
    const schema = GET_PROJECT_TOOL.inputSchema as JsonSchema;
    expect(validateInput({ projectId: "p1", include: ["billing"] }, schema).ok).toBe(false);
    expect(validateInput({ projectId: "p1", include: [] }, schema).ok).toBe(false);
  });

  it("returns only the overview by default", async () => {
    await expect(runGetProject("u1", { projectId: "p1" })).resolves.toEqual({
      overview: { id: "p1", from: "overview" },
    });
    expect(runGetProjectSettings).not.toHaveBeenCalled();
    expect(runGetProjectShowcase).not.toHaveBeenCalled();
  });

  it("returns each requested part under its own key", async () => {
    const out = await runGetProject("u1", { projectId: "p1", include: ["settings", "showcase"] });
    expect(out).toEqual({
      settings: { id: "p1", from: "settings" },
      showcase: { projectId: "p1", from: "showcase" },
    });
    expect(runGetProjectOverview).not.toHaveBeenCalled();
    expect(runGetProjectSettings).toHaveBeenCalledWith("u1", { projectId: "p1" });
    expect(runGetProjectShowcase).toHaveBeenCalledWith("u1", { projectId: "p1" });
  });

  it("returns all three parts", async () => {
    const out = await runGetProject("u1", { projectId: "p1", include: ["overview", "settings", "showcase"] });
    expect(Object.keys(out).sort()).toEqual(["overview", "settings", "showcase"]);
  });

  it("passes terms to the overview", async () => {
    await runGetProject("u1", { projectId: "p1", terms: ["22F"] });
    expect(runGetProjectOverview).toHaveBeenCalledWith({ projectId: "p1", terms: ["22F"] });
  });

  it("rejects terms without the overview part", async () => {
    await expect(
      runGetProject("u1", { projectId: "p1", include: ["settings"], terms: ["22F"] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(runGetProjectSettings).not.toHaveBeenCalled();
  });

  it("caps terms at 20 and rejects an empty list via the schema", () => {
    const schema = GET_PROJECT_TOOL.inputSchema as JsonSchema;
    expect(validateInput({ projectId: "p1", terms: [] }, schema).ok).toBe(false);
    expect(validateInput({ projectId: "p1", terms: Array.from({ length: 21 }, (_, i) => `t${i}`) }, schema).ok).toBe(false);
    expect(validateInput({ projectId: "p1", terms: ["22F", "23W"] }, schema).ok).toBe(true);
  });

  it("lets a part's not-found error through", async () => {
    vi.mocked(runGetProjectSettings).mockRejectedValue(Object.assign(new Error("Project p1 not found"), { status: 404 }));
    await expect(runGetProject("u1", { projectId: "p1", include: ["settings"] })).rejects.toMatchObject({ status: 404 });
  });
});
