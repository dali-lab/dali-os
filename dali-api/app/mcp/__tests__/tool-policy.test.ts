import { describe, it, expect } from "vitest";
import type { UserRoles } from "~/lib/roles";
import type { McpToolDef } from "../registry";
import { audienceAllows, toolAnnotations } from "../tool-policy";

const roles = (over: Partial<UserRoles> = {}): UserRoles => ({
  isLabMemberOrAlum: true,
  isLabMember: true,
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: false,
  canViewStaffing: false,
  ...over,
});

const def = (name: string, requiredScope: McpToolDef["requiredScope"]): McpToolDef => ({
  name,
  description: "",
  inputSchema: { type: "object" },
  requiredScope,
});

describe("audienceAllows", () => {
  it("shows a tool with no audience to every member", () => {
    expect(audienceAllows("read_page", roles())).toBe(true);
  });

  it("shows a Core tool to Core and hides it from other members", () => {
    expect(audienceAllows("list_partner_orgs", roles())).toBe(false);
    expect(audienceAllows("list_partner_orgs", roles({ isCore: true }))).toBe(true);
  });

  it("hides a Core tool from a domain lead who isn't Core", () => {
    expect(audienceAllows("list_domains", roles({ isDomainLead: true }))).toBe(false);
  });

  it("shows an admin tool only to admins, not to Core", () => {
    expect(audienceAllows("manage_group", roles({ isCore: true }))).toBe(false);
    expect(audienceAllows("manage_group", roles({ isCore: true, isAdmin: true }))).toBe(true);
  });
});

describe("toolAnnotations", () => {
  it("marks a read tool read-only and nothing else", () => {
    expect(toolAnnotations(def("read_page", "mcp:read"))).toEqual({ readOnlyHint: true });
  });

  it("keeps the destructive default for a write tool that isn't listed as additive", () => {
    expect(toolAnnotations(def("manage_drive_trash", "mcp:write"))).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("marks an additive write non-destructive", () => {
    expect(toolAnnotations(def("submit_form", "mcp:write")).destructiveHint).toBe(false);
  });

  it("marks a tool that reaches other people as open-world", () => {
    expect(toolAnnotations(def("send_announcement", "mcp:admin"))).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });
});
