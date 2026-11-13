import { describe, expect, it } from "vitest";
import { assigneeNames, orderMembers, pinnedMembers, toggleAssignee } from "../assignees";

const members = [
  { id: "b", name: "Beth Cho" },
  { id: "ar", name: "Arthur Ng" },
  { id: "jz", name: "Joyce Zou" },
  { id: "c", name: "Cal Poe" },
];

describe("orderMembers", () => {
  it("puts Joyce then Arthur first and keeps the rest in order", () => {
    expect(orderMembers(members).map((m) => m.id)).toEqual(["jz", "ar", "b", "c"]);
  });
});

describe("pinnedMembers", () => {
  it("shows Joyce and Arthur, then the signed-in user and anyone already picked", () => {
    expect(pinnedMembers(members, "c", []).map((m) => m.id)).toEqual(["jz", "ar", "c"]);
    expect(pinnedMembers(members, "jz", ["b"]).map((m) => m.id)).toEqual(["jz", "ar", "b"]);
  });
});

describe("toggleAssignee", () => {
  it("adds and removes", () => {
    expect(toggleAssignee([], "a")).toEqual(["a"]);
    expect(toggleAssignee(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("assigneeNames", () => {
  it("skips ids that are no longer members", () => {
    expect(assigneeNames(["jz", "gone", "ar"], members)).toEqual(["Joyce Zou", "Arthur Ng"]);
  });
});
