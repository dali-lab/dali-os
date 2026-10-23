import { describe, it, expect, beforeEach, vi } from "vitest";

const requireMobileUser = vi.fn();
const runListMyProjects = vi.fn();
const termFactsForUser = vi.fn();
vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/mcp/tools/list-my-projects", () => ({ runListMyProjects: (...a: unknown[]) => runListMyProjects(...a) }));
vi.mock("~/lib/mobile-members.server", () => ({ termFactsForUser: (...a: unknown[]) => termFactsForUser(...a) }));

import { loader } from "../api.mobile.projects";

const project = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  status: "Active",
  terms: ["26F"],
  currentTermAssignment: { termCode: "26F", domainName: "Fullstack Dev", level: "P2" },
  ...over,
});

const load = async () => (await (loader({ request: new Request("https://os.example/api/mobile/projects") } as never) as Promise<Response>)).json();

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1" });
  termFactsForUser.mockResolvedValue({ coreLeadTitle: "Delivery Lead", domainLeadOf: [] });
});

describe("GET /api/mobile/projects", () => {
  it("lists only projects the member is staffed on this term", async () => {
    runListMyProjects.mockResolvedValue({
      projects: [
        project("dali-os"),
        project("last-term", { terms: ["26S"], currentTermAssignment: null }),
        project("paused", { status: "Paused" }),
      ],
    });
    const { projects } = await load();
    expect(projects.map((p: { id: string }) => p.id)).toEqual(["dali-os", "paused"]);
    expect(projects[0]).toEqual({
      id: "dali-os",
      name: "dali-os",
      status: "Active",
      terms: ["26F"],
      myRole: "Fullstack Dev",
      myLeadRole: "Delivery Lead",
    });
  });

  it("leaves out an archived project even if staffed this term", async () => {
    runListMyProjects.mockResolvedValue({ projects: [project("old", { status: "Archived" })] });
    expect((await load()).projects).toEqual([]);
  });

  it("is empty for a member not staffed this term", async () => {
    runListMyProjects.mockResolvedValue({ projects: [project("past", { currentTermAssignment: null })] });
    expect((await load()).projects).toEqual([]);
  });
});
