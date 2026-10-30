import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JourneyContent } from "~/journeys/lib/types";

const state = vi.hoisted(() => ({ draft: null as unknown as JourneyContent }));
const server = vi.hoisted(() => ({
  resolveJourneyViewer: vi.fn(),
  editDraft: vi.fn(),
  createJourney: vi.fn(),
  publishJourney: vi.fn(),
  discardDraft: vi.fn(),
  deleteJourney: vi.fn(),
  findDomain: vi.fn(),
  loadJourneyById: vi.fn(),
  listViewerJourneys: vi.fn(),
  loadAccessEntries: vi.fn(),
  addCollaborator: vi.fn(),
  setCollaboratorRole: vi.fn(),
  removeCollaborator: vi.fn(),
}));
const db = vi.hoisted(() => ({
  onboardingJourney: { findUnique: vi.fn(async () => ({ domain: { code: "Fullstack" } })) },
  user: { findFirst: vi.fn() },
}));

vi.mock("~/journeys/lib/journeys.server", () => server);
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/collab/blocknote-server", () => ({
  markdownToBlocks: vi.fn(async (md: string) => [{ type: "paragraph", content: [{ type: "text", text: md, styles: {} }], children: [] }]),
  blocksToMarkdown: vi.fn(async (blocks: { content?: { text: string }[] }[]) => blocks.map((b) => b.content?.[0]?.text ?? "").join("\n")),
}));

import { JOURNEYS_TOOLS } from "../index";
import { mod } from "~/journeys/lib/__tests__/fixtures";

const ctx = { user: { id: "me" }, scopes: ["mcp:write"], request: new Request("http://x") } as never;
const tool = (name: string) => JOURNEYS_TOOLS.find((t) => t.def.name === name)!;
const call = (name: string, args: Record<string, unknown>) => tool(name).run(ctx, args);

beforeEach(() => {
  vi.clearAllMocks();
  state.draft = { title: "J", description: "", modules: [mod("a"), mod("b", ["a"])] };
  server.resolveJourneyViewer.mockResolvedValue({ id: "me", isCore: false, leadDomainIds: [] });
  server.editDraft.mockImplementation(async (_v, id, edit) => {
    state.draft = JSON.parse(JSON.stringify(await edit(state.draft)));
    return { ok: true, draft: { id, ...state.draft }, version: "v2" };
  });
});

describe("registration", () => {
  it("registers each tool once with a scope", () => {
    const names = JOURNEYS_TOOLS.map((t) => t.def.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["list_journeys", "get_journey", "manage_journey", "manage_journey_module", "manage_journey_page", "manage_journey_slides", "set_journey_lab", "set_journey_quiz", "manage_journey_access"]));
    for (const t of JOURNEYS_TOOLS) expect(t.def.requiredScope).toMatch(/^mcp:(read|write)$/);
  });

  it("refuses callers without journeys turned on", async () => {
    server.resolveJourneyViewer.mockResolvedValue(null);
    await expect(call("list_journeys", {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("manage_journey", () => {
  it("creates in a domain and applies the given details", async () => {
    server.findDomain.mockResolvedValue({ id: "dom" });
    server.createJourney.mockResolvedValue({ ok: true, id: "new" });
    const out = (await call("manage_journey", { action: "create", domain: "fullstack", title: "Git basics" })) as Record<string, unknown>;
    expect(server.createJourney).toHaveBeenCalledWith(expect.anything(), "dom");
    expect(state.draft.title).toBe("Git basics");
    expect(out).toMatchObject({ ok: true, journeyId: "new", editUrl: "/journeys/fullstack/new/edit" });
  });

  it("maps server refusals to MCP errors", async () => {
    server.findDomain.mockResolvedValue({ id: "dom" });
    server.createJourney.mockResolvedValue({ ok: false, status: 403, error: "No" });
    await expect(call("manage_journey", { action: "create", domain: "fullstack" })).rejects.toMatchObject({ status: 403 });
  });

  it("won't publish while issues remain", async () => {
    server.loadJourneyById.mockResolvedValue({ id: "j", draft: { title: "", description: "", modules: [] }, version: "v1" });
    await expect(call("manage_journey", { action: "publish", journeyId: "j" })).rejects.toThrow(/Fix these before publishing/);
    expect(server.publishJourney).not.toHaveBeenCalled();
  });

  it("publishes the current draft at its version", async () => {
    server.loadJourneyById.mockResolvedValue({ id: "j", draft: state.draft, version: "v1" });
    server.publishJourney.mockResolvedValue({ ok: true, version: "v2" });
    await call("manage_journey", { action: "publish", journeyId: "j" });
    expect(server.publishJourney).toHaveBeenCalledWith(expect.anything(), "j", state.draft, "v1");
  });

  it("requires per-action fields", async () => {
    await expect(call("manage_journey", { action: "update" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("manage_journey_module", () => {
  it("adds a module after another and returns its id", async () => {
    const out = (await call("manage_journey_module", { action: "add", journeyId: "j", afterModuleId: "b", title: "C" })) as { moduleId: string };
    const added = state.draft.modules.find((m) => m.id === out.moduleId)!;
    expect(added).toMatchObject({ title: "C", dependsOn: ["b"] });
  });

  it("sets prerequisites and refuses loops", async () => {
    await call("manage_journey_module", { action: "set_prerequisites", journeyId: "j", moduleId: "b", dependsOn: [] });
    expect(state.draft.modules[1].dependsOn).toEqual([]);
    await expect(
      call("manage_journey_module", { action: "set_prerequisites", journeyId: "j", moduleId: "a", dependsOn: ["b", "b"] }),
    ).resolves.toBeTruthy();
    await expect(call("manage_journey_module", { action: "set_prerequisites", journeyId: "j", moduleId: "b", dependsOn: ["a"] })).rejects.toThrow(/loop/);
  });

  it("deletes a module and reports unknown ones", async () => {
    await call("manage_journey_module", { action: "delete", journeyId: "j", moduleId: "a" });
    expect(state.draft.modules.map((m) => m.id)).toEqual(["b"]);
    expect(state.draft.modules[0].dependsOn).toEqual([]);
    await expect(call("manage_journey_module", { action: "delete", journeyId: "j", moduleId: "zz" })).rejects.toMatchObject({ status: 404 });
  });

  it("reports what still blocks publishing after a save", async () => {
    const out = (await call("manage_journey_module", { action: "update", journeyId: "j", moduleId: "a", title: "" })) as { publishIssues: string[] };
    expect(out.publishIssues).toContain("A module is missing a title.");
  });
});

describe("manage_journey_page", () => {
  it("adds, rewrites and moves pages with Markdown bodies", async () => {
    const out = (await call("manage_journey_page", { action: "add", journeyId: "j", moduleId: "a", title: "Intro", markdown: "Hello", index: 0 })) as { pageId: string };
    const pages = () => state.draft.modules[0].pages;
    expect(pages()[0]).toMatchObject({ id: out.pageId, title: "Intro" });
    expect(JSON.stringify(pages()[0].content)).toContain("Hello");
    await call("manage_journey_page", { action: "update", journeyId: "j", moduleId: "a", pageId: out.pageId, markdown: "Bye" });
    expect(JSON.stringify(pages()[0].content)).toContain("Bye");
    expect(pages()[0].title).toBe("Intro");
    await call("manage_journey_page", { action: "move", journeyId: "j", moduleId: "a", pageId: out.pageId, toIndex: 5 });
    expect(pages()[1].id).toBe(out.pageId);
  });
});

describe("manage_journey_slides", () => {
  it("replaces the deck and removes it when empty", async () => {
    await call("manage_journey_slides", { action: "set", journeyId: "j", moduleId: "a", slides: [{ layout: "title", title: "Hi" }, { layout: "content", title: "Points", bodyMarkdown: "- one" }] });
    expect(state.draft.modules[0].slides?.map((s) => s.layout)).toEqual(["title", "content"]);
    await call("manage_journey_slides", { action: "set", journeyId: "j", moduleId: "a", slides: [] });
    expect(state.draft.modules[0].slides).toBeUndefined();
  });

  it("updates only the given fields of a slide", async () => {
    await call("manage_journey_slides", { action: "set", journeyId: "j", moduleId: "a", slides: [{ layout: "split", title: "T", imageUrl: "/a.jpg", imageAlt: "A" }] });
    const id = state.draft.modules[0].slides![0].id;
    await call("manage_journey_slides", { action: "update", journeyId: "j", moduleId: "a", slideId: id, slide: { imageAlt: "Better" } });
    expect(state.draft.modules[0].slides![0]).toMatchObject({ id, title: "T", image: { src: "/a.jpg", alt: "Better" } });
  });
});

describe("set_journey_lab", () => {
  it("needs an index.html", async () => {
    await expect(call("set_journey_lab", { journeyId: "j", moduleId: "a", lab: { title: "L", files: { "a.js": "" }, steps: [] } })).rejects.toThrow(/index.html/);
  });

  it("gives steps ids and can remove the lab", async () => {
    await call("set_journey_lab", { journeyId: "j", moduleId: "a", lab: { title: "L", files: { "index.html": "<h1>x</h1>" }, steps: [{ title: "S", check: "true" }] } });
    expect(state.draft.modules[0].lab?.steps[0]).toMatchObject({ title: "S", check: "true", instructions: "" });
    expect(state.draft.modules[0].lab?.steps[0].id).toMatch(/^step-/);
    await call("set_journey_lab", { journeyId: "j", moduleId: "a", remove: true });
    expect(state.draft.modules[0].lab).toBeUndefined();
  });
});

describe("set_journey_quiz", () => {
  it("turns option strings and a correct index into a quiz", async () => {
    await call("set_journey_quiz", {
      journeyId: "j",
      moduleId: "a",
      quiz: { title: "Q", questions: [{ type: "multiple-choice", prompt: "2+2?", options: ["3", "4"], correctOption: 1 }, { type: "short-answer", prompt: "Why?" }] },
    });
    const [mc, sa] = state.draft.modules[0].quiz!.questions;
    expect(mc.type === "multiple-choice" && mc.options.find((o) => o.id === mc.correctOptionId)?.text).toBe("4");
    expect(sa).toMatchObject({ type: "short-answer", acceptedAnswers: [""] });
    expect(state.draft.modules[0].quiz!.passingScore).toBe(80);
  });

  it("rejects a correct index outside the options, and too few options", async () => {
    const q = (extra: object) => call("set_journey_quiz", { journeyId: "j", moduleId: "a", quiz: { title: "Q", questions: [{ type: "multiple-choice", prompt: "?", ...extra }] } });
    await expect(q({ options: ["a", "b"], correctOption: 2 })).rejects.toThrow(/correctOption/);
    await expect(q({ options: ["a"], correctOption: 0 })).rejects.toThrow(/two options/);
  });
});

describe("manage_journey_access", () => {
  it("adds by email and returns the people with access", async () => {
    db.user.findFirst.mockResolvedValue({ id: "u2" });
    server.addCollaborator.mockResolvedValue({ ok: true });
    server.loadAccessEntries.mockResolvedValue([{ id: "j", title: "J", role: "owner", people: [{ id: "u2", name: "Ana", email: "ana@x", role: "editor" }] }]);
    const out = await call("manage_journey_access", { action: "add", journeyId: "j", email: "Ana@X", role: "editor" });
    expect(db.user.findFirst.mock.calls[0][0].where.OR[0]).toEqual({ daliEmail: "ana@x" });
    expect(server.addCollaborator).toHaveBeenCalledWith(expect.anything(), "j", "u2", "editor");
    expect(out).toMatchObject({ people: [{ userId: "u2", role: "editor" }] });
  });

  it("reports an unknown email", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(call("manage_journey_access", { action: "remove", journeyId: "j", email: "nobody@x" })).rejects.toMatchObject({ status: 404 });
  });
});
