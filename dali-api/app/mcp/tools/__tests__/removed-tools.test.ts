import { describe, it, expect } from "vitest";
import { findRegistryTool } from "~/mcp/registry";

const REMOVED = [
  "get_project_overview",
  "get_project_settings",
  "get_project_showcase",
  "list_my_projects",
  "add_task_comment",
  "manage_task_files",
  "provision_epic_description_doc",
  "find_mutual_freebusy",
  "get_group_availability",
  "get_google_calendar_busy",
  "check_in_to_meeting",
  "check_in_to_session",
  "scan_attendee",
  "set_staffing_assignment",
  "set_domain_eligibility",
  "list_my_roles",
  "set_activity_visibility",
  "search_directory",
  "complete_onboarding_tour",
];

describe("projects, calendar and self-service tool surface", () => {
  it.each(REMOVED)("%s is no longer registered", (name) => {
    expect(findRegistryTool(name)).toBeUndefined();
  });

  it.each(["get_project", "find_free_times", "check_in", "list_projects", "list_members", "whoami", "update_profile"])(
    "%s is registered",
    (name) => {
      expect(findRegistryTool(name)).toBeDefined();
    },
  );

  it.each(["manage_class", "manage_calendar_link"])("%s names its discriminator action", (name) => {
    const schema = findRegistryTool(name)!.def.inputSchema as { properties: Record<string, unknown>; required?: string[] };
    expect(schema.properties).toHaveProperty("action");
    expect(schema.properties).not.toHaveProperty("intent");
    expect(schema.required).toContain("action");
  });

  it("mark_notification_read names its option action, not intent", () => {
    const schema = findRegistryTool("mark_notification_read")!.def.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("action");
    expect(schema.properties).not.toHaveProperty("intent");
  });

  it("manage_time_entry creates with create, not add", () => {
    const schema = findRegistryTool("manage_time_entry")!.def.inputSchema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(["create", "update", "delete"]);
  });
});
