import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import { REGISTRY_TOOLS, findRegistryTool, registryToolDefs } from "../registry";
import { FEATURE_FLAGS } from "~/lib/feature-flags";
import { validateInput } from "~/lib/mcp-input";
import { ASK_TOOL_NAMES } from "~/ask/tools.server";
import { ADDITIVE_TOOLS, OPEN_WORLD_TOOLS, TOOL_AUDIENCE } from "../tool-policy";

const VALIDATOR_KEYS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum",
  "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems",
]);
const ANNOTATION_KEYS = new Set(["description", "format", "default"]);

const READ_NAME = /^(get|list|read|search|find)_/;
const NON_READ_NAME_READ_SCOPE = new Set<string>([]);
const WRITE_NAME_READ_SCOPE = new Set<string>([
  "whoami",
  "search",
  "outline_content",
  "optimize_group_meetings",
]);

function unsupportedKeys(schema: unknown, path: string, out: string[]) {
  if (!schema || typeof schema !== "object") return;
  const s = schema as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    if (!VALIDATOR_KEYS.has(key) && !ANNOTATION_KEYS.has(key)) out.push(`${path}.${key}`);
  }
  const props = s.properties as Record<string, unknown> | undefined;
  if (props) for (const [k, v] of Object.entries(props)) unsupportedKeys(v, `${path}.properties.${k}`, out);
  if (s.items) unsupportedKeys(s.items, `${path}.items`, out);
}

describe("MCP registry invariants", () => {
  it("has unique tool names", () => {
    const names = REGISTRY_TOOLS.map((t) => t.def.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("gives every tool an object input schema", () => {
    expect(REGISTRY_TOOLS.filter((t) => t.def.inputSchema.type !== "object").map((t) => t.def.name)).toEqual([]);
  });

  it("uses only schema keywords the validator enforces", () => {
    const bad: string[] = [];
    for (const t of REGISTRY_TOOLS) unsupportedKeys(t.def.inputSchema, t.def.name, bad);
    expect(bad).toEqual([]);
  });

  it("lists every required property in properties", () => {
    const bad = REGISTRY_TOOLS.filter((t) => {
      const props = Object.keys(t.def.inputSchema.properties ?? {});
      return (t.def.inputSchema.required ?? []).some((r) => !props.includes(r));
    }).map((t) => t.def.name);
    expect(bad).toEqual([]);
  });

  it("keeps read-named tools off the write scope and other tools off the read scope", () => {
    const bad: string[] = [];
    for (const { def } of REGISTRY_TOOLS) {
      if (READ_NAME.test(def.name)) {
        if (def.requiredScope === "mcp:write") bad.push(def.name);
      } else if (def.requiredScope === "mcp:read" && !WRITE_NAME_READ_SCOPE.has(def.name)) {
        bad.push(def.name);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps the known scope exceptions pinned", () => {
    const scope = (n: string) => REGISTRY_TOOLS.find((t) => t.def.name === n)?.def.requiredScope;
    expect({ manage_form: scope("manage_form"), manage_page: scope("manage_page") }).toEqual({
      manage_form: "mcp:write",
      manage_page: "mcp:write",
    });
  });

  it("accepts null for the nullable ids the handlers already take", () => {
    const schema = (n: string) => REGISTRY_TOOLS.find((t) => t.def.name === n)!.def.inputSchema;
    expect(validateInput({ action: "move", pageId: "p1", parentPageId: null }, schema("manage_page")).ok).toBe(true);
    expect(validateInput({ title: "t", durationMinutes: 30, notebook: { title: "n", templatePageId: null } }, schema("schedule_meeting")).ok).toBe(true);
  });

  it("resolves every Ask DALI tool name to a registered read tool", () => {
    const byName = new Map(REGISTRY_TOOLS.map((t) => [t.def.name, t.def.requiredScope]));
    expect(ASK_TOOL_NAMES.filter((n) => byName.get(n) !== "mcp:read")).toEqual([]);
  });

  it("registers every exported tool definition under mcp/tools", async () => {
    const registered = new Set(REGISTRY_TOOLS.map((t) => t.def));
    const modules = import.meta.glob("../tools/**/*.ts") as Record<string, () => Promise<Record<string, unknown>>>;
    const unregistered: string[] = [];
    for (const [file, load] of Object.entries(modules)) {
      if (file.includes("__tests__")) continue;
      for (const [key, value] of Object.entries(await load())) {
        const def = value as { name?: unknown; inputSchema?: unknown } | null;
        if (/_TOOL$/.test(key) && def?.name && def.inputSchema && !registered.has(def as never)) unregistered.push(`${file} ${key}`);
      }
    }
    expect(unregistered).toEqual([]);
  });

  it("only gates tools on registered feature flags", () => {
    const keys = new Set<string>(FEATURE_FLAGS.map((f) => f.key));
    expect(REGISTRY_TOOLS.filter((t) => t.featureFlag && !keys.has(t.featureFlag)).map((t) => t.def.name)).toEqual([]);
  });

  it("keeps only the backfill tools still in use", () => {
    for (const name of ["backfill_terms", "backfill_core_assignments", "backfill_project_assignments"]) {
      expect(findRegistryTool(name)).toBeUndefined();
    }
    expect(findRegistryTool("backfill_hiring_cycle")).toBeDefined();
    expect(findRegistryTool("get_backfill_state")).toBeDefined();
  });

  it("has merged and split the forms, agreements and education tools", () => {
    const removed = [
      "get_form_summary",
      "get_form_tracker",
      "list_documents_to_sign",
      "list_my_signed_documents",
      "get_binding_to_sign",
      "get_signed_document",
      "submit_education_application",
      "withdraw_education_application",
    ];
    for (const name of removed) expect(findRegistryTool(name)).toBeUndefined();
    const added = [
      "set_form_questions",
      "remind_form_respondents",
      "list_my_agreements",
      "get_my_agreement",
      "remind_agreement_signers",
      "manage_my_education_application",
      "manage_offering_instructors",
    ];
    for (const name of added) expect(findRegistryTool(name)).toBeDefined();
  });

  it("marks the tools that email people open-world and the rest of the split tools not", () => {
    const open = (name: string) => OPEN_WORLD_TOOLS.has(name);
    expect(["remind_form_respondents", "remind_agreement_signers", "manage_offering_instructors"].every(open)).toBe(true);
    expect(["manage_form", "manage_education_offering", "set_form_questions"].some(open)).toBe(false);
    expect(open("manage_agreement")).toBe(true);
    expect(TOOL_AUDIENCE.remind_agreement_signers).toBe("core");
  });

  it("names only registered tools in the tool policy", () => {
    const names = new Set(REGISTRY_TOOLS.map((t) => t.def.name));
    const listed = [...Object.keys(TOOL_AUDIENCE), ...ADDITIVE_TOOLS, ...OPEN_WORLD_TOOLS];
    expect(listed.filter((n) => !names.has(n))).toEqual([]);
  });

  it("lists only write and admin tools as additive or open-world", () => {
    const scope = new Map(REGISTRY_TOOLS.map((t) => [t.def.name, t.def.requiredScope]));
    expect([...ADDITIVE_TOOLS, ...OPEN_WORLD_TOOLS].filter((n) => scope.get(n) === "mcp:read")).toEqual([]);
  });

  it("advertises every registry tool", () => {
    expect(registryToolDefs()).toHaveLength(REGISTRY_TOOLS.length);
  });
});
