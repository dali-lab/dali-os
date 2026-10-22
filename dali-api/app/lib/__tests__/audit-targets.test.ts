import { describe, it, expect, vi } from "vitest";
import {
  auditTargetModel,
  groupTargetIdsByModel,
  resolveAuditTargets,
  type AuditTargetPrisma,
} from "~/lib/audit-targets";
import { AUDIT_ACTIONS, AUDIT_AREAS, actionsInArea, auditAreaOf } from "~/lib/audit-actions";

describe("auditTargetModel", () => {
  it.each([
    ["page.pin", "page"],
    ["note.delete", "page"],
    ["document.delete", "page"],
    ["document.export", "page"],
    ["notebook.trash", "page"],
    ["notebook.merge", "page"],
    ["project.delete", "project"],
    ["project.showcase-status", "project"],
    ["staffing.finalize", "project"],
    ["projectFile.create", "projectFile"],
    ["group.member.add", "group"],
    ["domain.create", "domain"],
    ["domain.ready.set", "domain"],
    ["domain.rubric.set", "domain"],
    ["domain.mentors.add", "domain"],
    ["domain.challenge-form.remove", "domain"],
    ["email.domain_added_notice", "domain"],
    ["partner.org.update", "partnerOrg"],
    ["partner.invited", "partnerOrg"],
    ["education.offering.status", "educationOffering"],
    ["education.certificate.issue", "educationOffering"],
    ["activities.clone", "activity"],
    ["room.update", "room"],
    ["release_note.publish", "releaseNote"],
  ])("%s resolves against %s", (action, model) => {
    expect(auditTargetModel(action)).toBe(model);
  });

  it.each([
    "project.assignment.level",
    "domain.lead.add",
    "drive.trash.purge",
    "task.delete",
    "comment.delete",
    "member.resume.view",
    "room.display.revoke",
    "login.success",
    "staffing.assign",
    "mcp.tool_called",
    "education.session.create",
  ])("%s has no model (target is a user, mixed, or unlabeled)", (action) => {
    expect(auditTargetModel(action)).toBeNull();
  });
});

describe("groupTargetIdsByModel", () => {
  it("groups distinct ids by model and skips unmapped actions and null targets", () => {
    const grouped = groupTargetIdsByModel([
      { action: "page.pin", targetId: "p1" },
      { action: "note.delete", targetId: "p1" },
      { action: "note.delete", targetId: "p2" },
      { action: "project.delete", targetId: "j1" },
      { action: "login.success", targetId: "u1" },
      { action: "page.pin", targetId: null },
    ]);
    expect(grouped.get("page")).toEqual(["p1", "p2"]);
    expect(grouped.get("project")).toEqual(["j1"]);
    expect(grouped.size).toBe(2);
  });
});

describe("resolveAuditTargets", () => {
  it("runs one findMany per model present and attaches verified links", async () => {
    const page = { findMany: vi.fn().mockResolvedValue([{ id: "p1", title: "Notes" }]) };
    const project = { findMany: vi.fn().mockResolvedValue([{ id: "j1", name: "Atlas" }]) };
    const room = { findMany: vi.fn() };
    const db = { page, project, room } as unknown as AuditTargetPrisma;

    const out = await resolveAuditTargets(db, [
      { action: "page.pin", targetId: "p1" },
      { action: "note.delete", targetId: "p1" },
      { action: "project.delete", targetId: "j1" },
    ]);

    expect(page.findMany).toHaveBeenCalledTimes(1);
    expect(project.findMany).toHaveBeenCalledTimes(1);
    expect(room.findMany).not.toHaveBeenCalled();
    expect(out.get("p1")).toEqual({ label: "Notes", href: "/drive/reveal/p1" });
    expect(out.get("j1")).toEqual({ label: "Atlas", href: "/projects/j1" });
  });

  it("labels models without a detail route and omits missing rows", async () => {
    const room = { findMany: vi.fn().mockResolvedValue([{ id: "r1", name: "Studio" }]) };
    const db = { room } as unknown as AuditTargetPrisma;
    const out = await resolveAuditTargets(db, [
      { action: "room.update", targetId: "r1" },
      { action: "room.update", targetId: "gone" },
    ]);
    expect(out.get("r1")).toEqual({ label: "Studio", href: null });
    expect(out.has("gone")).toBe(false);
  });
});

describe("audit areas", () => {
  it("folds hiring prefixes into one area", () => {
    for (const a of [
      "application.submit",
      "application.view",
      "decision.create",
      "interview.cancel",
      "interview.config",
      "review.submit",
      "review.update",
      "delibs.close",
      "cycle.create",
      "rubric.version.create",
      "confidentiality.rename",
    ]) {
      expect(auditAreaOf(a)).toBe("hiring");
    }
  });

  it("folds document-like and work-item prefixes into their product area", () => {
    for (const a of ["collab.version.restore", "notebook.dissolve", "comment.delete", "document.export"]) {
      expect(auditAreaOf(a)).toBe("page");
    }
    for (const a of ["task.delete", "epic.delete"]) expect(auditAreaOf(a)).toBe("project");
    expect(auditAreaOf("custom-hire.archive")).toBe("payroll");
  });

  it("uses the first segment otherwise", () => {
    expect(auditAreaOf("staffing.assign")).toBe("staffing");
    expect(auditAreaOf("mcp.tool_read")).toBe("mcp");
    expect(auditAreaOf("login.success")).toBe("auth");
  });

  it("lists each area once and every action belongs to a listed area", () => {
    const values = AUDIT_AREAS.map((a) => a.value);
    expect(new Set(values).size).toBe(values.length);
    for (const a of AUDIT_ACTIONS) expect(values).toContain(auditAreaOf(a));
  });

  it("actionsInArea partitions the action list", () => {
    const total = AUDIT_AREAS.reduce((n, a) => n + actionsInArea(a.value).length, 0);
    expect(total).toBe(AUDIT_ACTIONS.length);
  });
});
