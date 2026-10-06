import { describe, it, expect } from "vitest";
import { groupKind, isEmptyAutoGroup, orderGroupsForPicker } from "~/lib/group-kind";

describe("groupKind", () => {
  it("classifies by systemKey prefix", () => {
    expect(groupKind({ systemKey: null })).toBe("custom");
    expect(groupKind({ systemKey: "core" })).toBe("lab");
    expect(groupKind({ systemKey: "hiring" })).toBe("lab");
    expect(groupKind({ systemKey: "alumni" })).toBe("lab");
    expect(groupKind({ systemKey: "project:abc" })).toBe("project");
    expect(groupKind({ systemKey: "domain:abc" })).toBe("domain");
    expect(groupKind({ systemKey: "term:abc" })).toBe("term");
    expect(groupKind({ systemKey: "offering:abc" })).toBe("offering");
  });
});

describe("isEmptyAutoGroup", () => {
  it("is false for custom groups even when empty", () => {
    expect(isEmptyAutoGroup({ systemKey: null, memberIds: [] })).toBe(false);
  });
  it("is true only for auto groups with no members", () => {
    expect(isEmptyAutoGroup({ systemKey: "term:x", memberIds: [] })).toBe(true);
    expect(isEmptyAutoGroup({ systemKey: "term:x", memberIds: ["u"] })).toBe(false);
    expect(isEmptyAutoGroup({ systemKey: "term:x", memberCount: 0 })).toBe(true);
  });
});

describe("orderGroupsForPicker", () => {
  const groups = [
    { id: "t", name: "Term 27F", systemKey: "term:1", memberIds: [] },
    { id: "p", name: "Project Zed", systemKey: "project:1", memberIds: ["u"] },
    { id: "c", name: "Mentors", systemKey: null, memberIds: [] },
    { id: "l", name: "Core", systemKey: "core", memberIds: ["u"] },
    { id: "d", name: "Domain Eng", systemKey: "domain:1", memberIds: ["u"] },
  ];
  it("drops empty auto groups and orders custom, lab, project, domain, term", () => {
    expect(orderGroupsForPicker(groups).map((g) => g.id)).toEqual(["c", "l", "p", "d"]);
  });
  it("keeps an empty auto group that is already selected", () => {
    expect(orderGroupsForPicker(groups, ["t"]).map((g) => g.id)).toEqual(["c", "l", "p", "d", "t"]);
  });
});
