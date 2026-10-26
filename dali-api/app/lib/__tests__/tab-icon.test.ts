import { describe, expect, it } from "vitest";
import { Calendar, FileText, FolderKanban, HardDrive, Home, Kanban, Mail, UsersRound } from "lucide-react";
import { tabIcon } from "~/lib/tab-icon";

describe("tabIcon", () => {
  it("maps the pinned surfaces", () => {
    expect(tabIcon("/")).toBe(Home);
    expect(tabIcon("/calendar")).toBe(Calendar);
    expect(tabIcon("/calendar/check-in/x")).toBe(Calendar);
    expect(tabIcon("/email?folder=sent")).toBe(Mail);
    expect(tabIcon("/drive")).toBe(HardDrive);
    expect(tabIcon("/drive/folder/abc")).toBe(HardDrive);
  });

  it("uses the document glyph for documents", () => {
    expect(tabIcon("/documents/abc")).toBe(FileText);
  });

  it("uses the area sub-tab icon", () => {
    expect(tabIcon("/core/staffing")).toBe(Kanban);
    expect(tabIcon("/core/staffing?term=25F")).toBe(Kanban);
  });

  it("falls back to the area icon for a page inside an area", () => {
    expect(tabIcon("/projects/some-project-id")).toBe(FolderKanban);
  });

  it("uses the sub-tab's icon for a page inside it, not the area's", () => {
    expect(tabIcon("/members/abc")).toBe(UsersRound);
  });

  it("falls back to the document glyph for unknown urls", () => {
    expect(tabIcon("/nowhere/at/all")).toBe(FileText);
  });
});
